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
const JOBS_PREFIX = 'jobs';
const jobKey = (id: string) => `${JOBS_PREFIX}/${id}`;

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

/**
 * 인덱스만은 **읽지 못해도 견딘다.** 저장소는 이제 깨진 JSON을 만나면 던지는데
 * (`lib/store/file-store.ts`), 그 규칙이 옳은 이유와 여기서 예외를 두는 이유가 같은 뿌리다.
 *
 * 원본에는 시끄럽게, **파생된 투영에는 관대하게.**
 *
 * 수강생의 목소리 목록은 그 사실의 유일한 사본이라, 깨진 것을 "목소리가 없습니다"로 읽으면
 * 본인에게도 고칠 사람에게도 유실이 감춰진다 — 그래서 던져야 한다. `job-index`는 정반대다.
 * 정본은 `jobs/<id>`이고 인덱스는 그 투영일 뿐이며, 고아 쓸기(`sweepOrphans`)가 바로
 * 이걸 `jobs/`에서 다시 만들어 내려고 존재한다. 여기서 던지면 **인덱스를 고칠 수 있는
 * 유일한 경로가 함께 멈춘다** — 워커가 아무 잡도 집지 못하게 되고, 그건 인덱스가 깨져서
 * 잃은 것보다 크다.
 *
 * 일관성을 위해 이걸 "되돌리지" 말 것. 의도한 비대칭이다.
 *
 * 깨진 이유는 가리지 않는다. 어떤 이유로든 못 읽으면 투영은 다시 만들면 그만이고, 저장소가
 * 통째로 아픈 경우라면 쓸기가 `jobs/<id>`를 읽다가 그때 시끄럽게 실패한다.
 *
 * @returns `corrupt`는 "읽지 못했다"는 뜻이다 — 부르는 쪽이 쓸기를 앞당길 때 쓴다.
 */
async function readIndex(): Promise<{ entries: JobIndexEntry[]; corrupt: boolean }> {
  try {
    return { entries: await store.read<JobIndexEntry[]>(INDEX_KEY, []), corrupt: false };
  } catch {
    return { entries: [], corrupt: true };
  }
}

const entryOf = (job: RenderJob): JobIndexEntry => ({
  id: job.id,
  status: job.status,
  createdAt: job.createdAt,
  claimedAt: job.claimedAt,
});

/**
 * 인덱스는 투영이다. 호출자는 반드시 잡을 먼저 쓴 뒤에 이걸 부른다.
 *
 * 인덱스를 못 읽었으면 이 잡 하나만 담은 배열을 쓴다. 나머지 항목은 그 순간 사라지지만
 * 파일은 다시 유효한 JSON이 되고, 사라진 항목은 쓸기가 `jobs/`에서 되찾는다.
 */
async function putIndexEntry(job: RenderJob): Promise<void> {
  const { entries: index } = await readIndex();
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

async function claimFrom(index: JobIndexEntry[], now: Date): Promise<RenderJob | null> {
  const candidates = index
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

/**
 * 고아 쓸기 간격. 워커는 5초마다 폴링한다(`worker/index.ts`의 `INTERVAL_MS`).
 *
 * 쓸기가 필요한 상태는 정확히 **큐가 비어 보이는 상태**이므로, 조이지 않으면 노는 동안
 * 매 폴링마다 목록을 훑게 된다. 30초면 여섯 번에 한 번만 훑고, 잃어버린 enqueue는 늦어도
 * 30초 안에 그 폴링에서 바로 복구된다 — 수강생이 "안 되네" 하고 다시 누르기 전이다.
 */
export const SWEEP_INTERVAL_MS = 30 * 1000;

/** 프로세스별 상태다. 인스턴스가 여러 개면 각자 쓸어서, 더 자주 낫는 쪽으로만 틀린다. */
let lastSweptAt = 0;

function sweepDue(now: Date): boolean {
  const elapsed = now.getTime() - lastSweptAt;
  // 시계가 뒤로 가면(프로세스 시계 조정, 또는 테스트가 시각을 직접 주는 경우) 음수가 된다.
  // 그때 쓸기가 영영 막히면 안 되므로 음수도 "때가 됐다"로 본다.
  return elapsed >= SWEEP_INTERVAL_MS || elapsed < 0;
}

/**
 * 인덱스에 항목이 없는 잡을 찾아 인덱스로 되돌린다.
 *
 * 인덱스 쓰기를 잃었을 때 셋 중 둘은 스스로 낫는다. 클레임을 잃으면 재확인이 걸러 주고
 * 다음 전이가 항목을 고쳐 쓰며, 완료를 잃으면 재확인이 계속 걸러 낼 뿐이다.
 * **enqueue를 잃은 경우만 낫지 않는다** — 잡은 `jobs/<id>`에 `queued`로 멀쩡히 있는데
 * 인덱스에 없고, `claimNextJob`은 인덱스만 보므로 아무 워커도 집어가지 않는다. 집어가지
 * 않으니 상태 전이도 없고, 전이가 없으니 항목을 다시 쓸 기회도 없다. 수강생 눈에는
 * "만들기를 눌렀는데 0%에서 멈춘" 것으로 보인다 — 이 계획이 없애려는 바로 그 증상이다.
 *
 * 상태는 잡에서 그대로 가져온다. 이미 끝난 잡을 `queued`로 되살리지 않는다.
 *
 * @returns 되돌린 것이 있으면 새 인덱스, 없으면 `null`
 */
async function sweepOrphans(now: Date, index: JobIndexEntry[]): Promise<JobIndexEntry[] | null> {
  lastSweptAt = now.getTime();

  const known = new Set(index.map((e) => e.id));
  const orphanIds = (await store.list(`${JOBS_PREFIX}/`))
    .map((key) => key.slice(JOBS_PREFIX.length + 1))
    .filter((id) => id !== '' && !known.has(id));
  if (orphanIds.length === 0) return null;

  const recovered: JobIndexEntry[] = [];
  for (const id of orphanIds) {
    const job = await store.read<RenderJob | null>(jobKey(id), null);
    if (job) recovered.push(entryOf(job));
  }
  if (recovered.length === 0) return null;

  const next = [...index, ...recovered];
  await store.write(INDEX_KEY, next);
  return next;
}

/**
 * 워커가 폴링할 때마다 부른다. 인덱스 한 번 + 후보 잡 한 번, 보통 읽기 두 번으로 끝난다.
 * 잡 전부를 읽지 않는다 — 잡은 계속 쌓이기만 하므로 폴링 비용이 잡 수에 비례하면 안 된다.
 *
 * 후보가 하나도 없을 때만, 그리고 `SWEEP_INTERVAL_MS`마다 한 번만 고아를 쓴다.
 */
export async function claimNextJob(now: Date = new Date()): Promise<RenderJob | null> {
  const { entries: index, corrupt } = await readIndex();
  const claimed = await claimFrom(index, now);
  if (claimed) return claimed;

  /**
   * 인덱스를 못 읽었으면 30초를 기다리지 않는다. 스로틀은 인덱스가 멀쩡한데 후보만 없는
   * **흔한** 경우에 매 폴링마다 `jobs/`를 훑지 않으려고 있는 것이고, 그 경우 기다림은
   * 실제로 비용을 아낀다. 인덱스를 못 읽는 상태는 정확히 쓸기가 고치라고 만들어진 상태라,
   * 여기서 기다리는 것은 아무것도 사지 못하면서 큐 전체를 최대 30초 멈춰 세울 뿐이다.
   */
  if (!corrupt && !sweepDue(now)) return null;
  const recovered = await sweepOrphans(now, index);
  return recovered ? await claimFrom(recovered, now) : null;
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
