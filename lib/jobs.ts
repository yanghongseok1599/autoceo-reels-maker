import { store } from './store';

export const STALE_CLAIM_MS = 15 * 60 * 1000;

export interface RenderJob {
  id: string;
  projectId: string;
  ownerId: string;
  engine: 'remotion';
  status: 'queued' | 'claimed' | 'rendering' | 'completed' | 'failed';
  progress: number;
  claimedAt: string | null;
  resultUrl: string | null;
  error: string | null;
  createdAt: string;
}

/**
 * 잡 하나가 자기 키를 가진다. 예전에는 모든 잡이 `jobs` 배열 하나에 들어 있어서,
 * 갱신할 때마다 배열 전체를 읽어-수정-쓰기 했다. 렌더 한 건이 진행률을 10·30·55·70·100으로
 * 다섯 번 보고하는 동안 수강생이 "만들기"를 누르면, 진행률 쓰기가 그 사이 들어온 잡을
 * 통째로 지웠다 — 그 수강생에게는 아무 일도 일어나지 않은 것처럼 보였다.
 */
const jobKey = (id: string) => `jobs/${id}`;

/**
 * `claimNextJob`이 후보를 고르기 위한 **투영**이다. 정본은 어디까지나 `jobs/<id>`이고,
 * 둘이 어긋나면 잡이 이긴다. 그래서 잡을 먼저 쓰고 인덱스를 나중에 쓴다.
 */
const INDEX_KEY = 'job-index';

export interface JobIndexEntry {
  id: string;
  status: RenderJob['status'];
  createdAt: string;
  claimedAt: string | null;
}

const readIndex = () => store.read<JobIndexEntry[]>(INDEX_KEY, []);

const entryOf = (job: RenderJob): JobIndexEntry => ({
  id: job.id,
  status: job.status,
  createdAt: job.createdAt,
  claimedAt: job.claimedAt,
});

/** 인덱스는 투영이다. 호출자는 반드시 잡을 먼저 쓴 뒤에 이걸 부른다. */
async function putIndexEntry(job: RenderJob): Promise<void> {
  const index = await readIndex();
  const next = entryOf(job);
  await store.write(
    INDEX_KEY,
    index.some((e) => e.id === job.id)
      ? index.map((e) => (e.id === job.id ? next : e))
      : [...index, next],
  );
}

export async function enqueueJob(input: { projectId: string; ownerId: string }): Promise<RenderJob> {
  const job: RenderJob = {
    id: `job_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    projectId: input.projectId,
    ownerId: input.ownerId,
    engine: 'remotion',
    status: 'queued',
    progress: 0,
    claimedAt: null,
    resultUrl: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  await store.write(jobKey(job.id), job);
  await putIndexEntry(job);
  return job;
}

/**
 * 인덱스 항목과 잡이 같은 필드를 갖고 있어서 양쪽에 쓸 수 있다 — 후보를 고를 때는
 * 인덱스로, 클레임 직전 재확인할 때는 잡으로.
 */
function isClaimable(job: Pick<RenderJob, 'status' | 'claimedAt'>, now: Date): boolean {
  if (job.status === 'queued') return true;
  if (job.status !== 'claimed' && job.status !== 'rendering') return false;
  if (!job.claimedAt) return false;
  return now.getTime() - Date.parse(job.claimedAt) > STALE_CLAIM_MS;
}

/**
 * 워커가 폴링할 때마다 부른다. 인덱스 한 번 + 후보 잡 한 번, 보통 읽기 두 번으로 끝난다.
 * 잡 전부를 읽지 않는다 — 잡은 계속 쌓이기만 하므로 폴링 비용이 잡 수에 비례하면 안 된다.
 */
export async function claimNextJob(now: Date = new Date()): Promise<RenderJob | null> {
  const candidates = (await readIndex())
    .filter((e) => isClaimable(e, now))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  for (const candidate of candidates) {
    // 인덱스는 낡을 수 있다. 정본을 다시 읽어 확인하지 않으면 이미 끝난 잡을 다시 내준다.
    const job = await store.read<RenderJob | null>(jobKey(candidate.id), null);
    if (!job || !isClaimable(job, now)) continue;

    const claimed: RenderJob = { ...job, status: 'claimed', claimedAt: now.toISOString() };
    await store.write(jobKey(claimed.id), claimed);
    await putIndexEntry(claimed);
    return claimed;
  }
  return null;
}

export async function updateJob(
  id: string,
  patch: Partial<Pick<RenderJob, 'status' | 'progress' | 'resultUrl' | 'error'>>,
): Promise<RenderJob | null> {
  const current = await store.read<RenderJob | null>(jobKey(id), null);
  if (!current) return null;

  const next: RenderJob = { ...current, ...patch };
  await store.write(jobKey(id), next);

  // 인덱스가 실어 나르는 필드가 실제로 바뀔 때만 인덱스를 쓴다. 진행률은 렌더 한 건에
  // 다섯 번 넘게 오지만 상태 전이는 세 번뿐이라, 가장 잦은 갱신이 큐와 아예 겹치지 않는다.
  if (next.status !== current.status || next.claimedAt !== current.claimedAt) {
    await putIndexEntry(next);
  }
  return next;
}

export async function getJob(id: string): Promise<RenderJob | null> {
  return await store.read<RenderJob | null>(jobKey(id), null);
}
