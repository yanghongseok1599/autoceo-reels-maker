import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  enqueueJob, claimNextJob, updateJob, getJob,
  STALE_CLAIM_MS, SWEEP_INTERVAL_MS,
  type RenderJob, type JobIndexEntry,
} from '../jobs';
import { store } from '../store';
import { resetStoreForTests } from '../store/file-store';

// 실제 .local-data/를 건드리지 않는다 — 거기엔 사용자의 학습 기록이 들어 있다.
beforeEach(async () => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
  await resetStoreForTests();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('job queue', () => {
  it('enqueues a job in queued state', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    expect(job.status).toBe('queued');
    expect(job.progress).toBe(0);
  });

  it('claims the oldest queued job exactly once', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await enqueueJob({ projectId: 'p2', ownerId: 'u1' });
    const first = await claimNextJob();
    const second = await claimNextJob();
    expect(first?.projectId).toBe('p1');
    expect(second?.projectId).toBe('p2');
    expect(await claimNextJob()).toBeNull();
  });

  it('marks claimed jobs so they are not handed out again', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const claimed = await claimNextJob();
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedAt).not.toBeNull();
  });

  it('reclaims a job whose claim went stale', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const claimed = await claimNextJob(new Date('2026-01-01T00:00:00Z'));
    expect(claimed).not.toBeNull();
    const later = new Date(Date.parse('2026-01-01T00:00:00Z') + STALE_CLAIM_MS + 1000);
    const reclaimed = await claimNextJob(later);
    expect(reclaimed?.id).toBe(claimed!.id);
  });

  it('records completion', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await updateJob(job.id, { status: 'completed', progress: 100, resultUrl: '/out.mp4' });
    const found = await getJob(job.id);
    expect(found?.status).toBe('completed');
    expect(found?.resultUrl).toBe('/out.mp4');
  });

  // 이 Task 전체의 이유. 옛 구조에서는 진행률 갱신이 그 사이 들어온 잡을 지웠다.
  it('keeps a job enqueued while another job is being updated', async () => {
    const running = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const [, fresh] = await Promise.all([
      updateJob(running.id, { progress: 55 }),
      enqueueJob({ projectId: 'p2', ownerId: 'u2' }),
    ]);
    expect(await getJob(fresh.id)).not.toBeNull();
    expect((await getJob(running.id))?.progress).toBe(55);
    // 남아 있기만 해서는 부족하다. 큐에서 빠지면 워커가 집어가지 않고, 그 수강생에게는
    // 여전히 아무 일도 일어나지 않는다. `running`이 더 먼저 들어왔으므로 두 번째가 `fresh`다.
    expect(await claimNextJob()).not.toBeNull();
    expect((await claimNextJob())?.id).toBe(fresh.id);
  });

  it('does not touch the index for a progress-only update', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const before = await store.read('job-index', []);
    /**
     * 내용 비교만으로는 이 규칙을 검사할 수 없다 — 진행률은 인덱스 항목에 없는 필드라,
     * 인덱스를 쓸데없이 다시 써도 내용은 똑같이 나온다. 큐에 들어온 잡을 지우는 것은
     * 내용이 아니라 **쓰기 그 자체**이므로, 어떤 키에 썼는지를 센다.
     */
    const writes = vi.spyOn(store, 'write');
    await updateJob(job.id, { progress: 30 });
    expect(writes.mock.calls.map(([key]) => key)).toEqual([`jobs/${job.id}`]);
    expect(await store.read('job-index', [])).toEqual(before);
  });

  it('updates the index when the status changes', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const writes = vi.spyOn(store, 'write');
    await updateJob(job.id, { status: 'completed' });
    // 잡이 정본이고 인덱스는 투영이다. 잡을 먼저 쓰고 인덱스를 나중에 써야, 그 사이에
    // 죽더라도 인덱스가 앞서 나가 이미 끝난 잡을 큐가 계속 내주는 일이 없다.
    expect(writes.mock.calls.map(([key]) => key)).toEqual([`jobs/${job.id}`, 'job-index']);
    const index = await store.read<{ id: string; status: string }[]>('job-index', []);
    expect(index.find((e) => e.id === job.id)?.status).toBe('completed');
  });

  it('writes each job to its own key', async () => {
    const writes = vi.spyOn(store, 'write');
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    expect(writes.mock.calls.map(([key]) => key)).toEqual([`jobs/${job.id}`, 'job-index']);
    expect(await store.read(`jobs/${job.id}`, null)).not.toBeNull();
    expect(await store.read('jobs', null)).toBeNull();
  });

  // 인덱스가 낡았어도 잡이 정본이다.
  it('does not claim a job the index still calls queued but the job says completed', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await store.write(`jobs/${job.id}`, { ...job, status: 'completed' });
    expect(await claimNextJob()).toBeNull();
  });
});

/**
 * 인덱스 쓰기를 잃는 세 경우 중 enqueue만 스스로 낫지 못한다. 잡은 `queued`로 멀쩡히
 * 있는데 인덱스에 항목이 없으면 아무 워커도 집어가지 않고, 집어가지 않으니 항목을 다시
 * 쓸 전이도 영영 오지 않는다. 수강생에게는 0%에서 멈춘 것으로 보인다.
 */
/**
 * 저장소는 이제 깨진 JSON을 만나면 던진다. 그 규칙에 **인덱스만 예외**인 것이 의도이고,
 * 여기서 양쪽을 다 잡아 둔다 — 한쪽만 있으면 다음 사람이 "일관성"을 이유로 되돌린다.
 */
describe('깨진 job-index는 견디고, 원본이 깨지면 던진다', () => {
  /**
   * 실제로 겪은 모양 그대로 **날바이트**를 심는다. `store.write`로는 이 상태를 만들 수 없다 —
   * 그건 값을 JSON으로 직렬화하므로 깨진 문자열조차 멀쩡한 JSON 문자열로 저장된다.
   */
  async function plantCorrupt(key: string): Promise<void> {
    const target = path.join(process.env.STORE_DIR as string, `${key}.json`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '[{"id":"job_x"}\n]]', 'utf8');
  }

  function queuedJob(id: string): RenderJob {
    return {
      id, projectId: 'p1', ownerId: 'u1', engine: 'remotion', status: 'queued',
      progress: 0, claimedAt: null, resultUrl: null, error: null,
      createdAt: '2026-08-28T00:00:00.000Z',
    };
  }

  /**
   * 인덱스는 `jobs/<id>`의 투영일 뿐이고 쓸기가 그걸 다시 만든다. 여기서 던지면
   * 인덱스를 고칠 수 있는 유일한 경로까지 멈춰, 워커가 아무 잡도 집지 못한다.
   */
  it('still claims a queued job when the index is malformed', async () => {
    const t0 = new Date('2026-08-28T00:00:00.000Z');
    // 스로틀은 이 검사의 관심사가 아니다. 먼저 쓸어서 시계를 맞춰 두고 만료시킨 뒤에 본다 —
    // 앞선 테스트가 남긴 `lastSweptAt`(모듈 상태)에 결과가 좌우되지 않게 한다.
    await claimNextJob(t0);

    const job = queuedJob('job_corrupt_idx');
    await store.write(`jobs/${job.id}`, job);
    await plantCorrupt('job-index');

    const claimed = await claimNextJob(new Date(t0.getTime() + SWEEP_INTERVAL_MS));
    expect(claimed?.id).toBe(job.id);
  });

  /**
   * 그리고 기다리지 않는다. 스로틀은 인덱스가 멀쩡한데 후보만 없을 때 `jobs/` 훑기를
   * 아끼려고 있는 것이고, 못 읽는 인덱스는 정확히 쓸기가 고치라고 있는 상태다.
   */
  it('sweeps immediately instead of stalling for the throttle', async () => {
    const t0 = new Date('2026-08-28T00:00:00.000Z');
    // 스로틀을 켜 둔다 — 방금 쓸었으므로 멀쩡한 인덱스였다면 기다려야 한다.
    await claimNextJob(t0);

    const job = queuedJob('job_no_wait');
    await store.write(`jobs/${job.id}`, job);
    await plantCorrupt('job-index');

    const claimed = await claimNextJob(new Date(t0.getTime() + 1000));
    expect(claimed?.id).toBe(job.id);
  });

  // 인덱스는 다시 유효한 JSON이 된다 — 못 읽은 상태가 눌러앉지 않는다.
  it('leaves the index readable again after the sweep rebuilds it', async () => {
    const t0 = new Date('2026-08-28T00:00:00.000Z');
    await claimNextJob(t0);

    const job = queuedJob('job_rebuilt');
    await store.write(`jobs/${job.id}`, job);
    await plantCorrupt('job-index');

    await claimNextJob(new Date(t0.getTime() + SWEEP_INTERVAL_MS));
    const index = await store.read<JobIndexEntry[]>('job-index', []);
    expect(index.map((e) => e.id)).toEqual([job.id]);
  });

  /**
   * 반대쪽. 잡 자체는 **정본**이므로 깨졌으면 조용히 "없음"이 되면 안 된다 — 그러면
   * 수강생의 잡이 흔적 없이 사라진 것처럼 보인다.
   */
  it('throws when the job shard itself is malformed', async () => {
    await plantCorrupt('jobs/job_bad');
    await expect(getJob('job_bad')).rejects.toThrow('저장소 값이 깨져 읽을 수 없습니다');
  });

  // 수강생 소유 데이터도 정본이다. 깨진 것을 빈 목록으로 읽으면 유실이 감춰진다.
  it('throws when an owner-scoped store is malformed', async () => {
    await plantCorrupt('fish-voices/u1');
    await expect(store.read('fish-voices/u1', [])).rejects.toThrow(
      '저장소 값이 깨져 읽을 수 없습니다: fish-voices/u1',
    );
  });
});

describe('orphan sweep', () => {
  const orphanJob = (over: Partial<RenderJob> = {}): RenderJob => ({
    id: `job_${Math.random().toString(16).slice(2, 18)}`,
    projectId: 'p1', ownerId: 'u1', engine: 'remotion',
    status: 'queued', progress: 0, claimedAt: null,
    resultUrl: null, error: null, createdAt: '2026-03-01T00:00:00Z',
    ...over,
  });

  const indexIds = async () =>
    (await store.read<JobIndexEntry[]>('job-index', [])).map((e) => e.id);

  it('recovers a lost enqueue, but not before the sweep is due', async () => {
    // 빈 폴링 한 번으로 쓸기 시계를 이 시각에 맞춘다.
    const t0 = new Date('2026-03-01T00:00:00Z');
    expect(await claimNextJob(t0)).toBeNull();

    // 인덱스 쓰기를 잃은 enqueue를 그대로 재현한다: 잡만 있고 인덱스에는 없다.
    const orphan = orphanJob();
    await store.write(`jobs/${orphan.id}`, orphan);
    expect(await indexIds()).toEqual([]);

    // 아직 때가 아니다. 여기서 집어간다면 폴링마다 목록을 훑고 있다는 뜻이다.
    expect(await claimNextJob(new Date(t0.getTime() + SWEEP_INTERVAL_MS - 1000))).toBeNull();

    // 때가 되면 인덱스로 돌아오고 그 폴링에서 바로 나간다.
    const claimed = await claimNextJob(new Date(t0.getTime() + SWEEP_INTERVAL_MS));
    expect(claimed?.id).toBe(orphan.id);
    expect(await indexIds()).toEqual([orphan.id]);
  });

  // 쓸기는 복구지 부활이 아니다. 끝난 잡을 다시 큐에 넣으면 학생 영상이 두 번 렌더된다.
  it('does not resurrect a terminal job it finds outside the index', async () => {
    const t0 = new Date('2026-04-01T00:00:00Z');
    expect(await claimNextJob(t0)).toBeNull();

    const done = orphanJob({ status: 'completed', progress: 100, resultUrl: '/out.mp4' });
    await store.write(`jobs/${done.id}`, done);

    const after = new Date(t0.getTime() + SWEEP_INTERVAL_MS);
    expect(await claimNextJob(after)).toBeNull();
    // 인덱스에는 들어오되 완료 상태로 들어온다 — 그래야 폴링마다 다시 훑지 않는다.
    const index = await store.read<JobIndexEntry[]>('job-index', []);
    expect(index.map((e) => ({ id: e.id, status: e.status })))
      .toEqual([{ id: done.id, status: 'completed' }]);
  });

  // 쓸기가 인덱스에 이미 있는 잡을 중복으로 넣으면, 같은 잡이 두 번 나가거나 인덱스가 부푼다.
  it('leaves jobs the index already knows alone', async () => {
    const t0 = new Date('2026-05-01T00:00:00Z');
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    expect((await claimNextJob(t0))?.id).toBe(job.id);
    await updateJob(job.id, { status: 'completed' });

    expect(await claimNextJob(new Date(t0.getTime() + SWEEP_INTERVAL_MS))).toBeNull();
    expect(await indexIds()).toEqual([job.id]);
  });
});

/**
 * 낡은 클레임(stale claim)은 **렌더 도중 워커가 죽었을 때 그 잡을 되찾는 유일한 길이다.**
 * 창이 너무 짧으면 멀쩡히 렌더 중인 잡을 두 워커가 동시에 집어 같은 파일에 쓰고,
 * 너무 길면 죽은 워커가 물고 있는 잡이 그만큼 큐에 갇힌다. 어느 쪽도 오류를 내지 않는다.
 *
 * 위의 "reclaims a job whose claim went stale"는 `STALE_CLAIM_MS`를 **import해서** 시각을
 * 만든다. 그래서 상수가 15분에서 1.5분이 되든 150분이 되든 검사도 같이 따라 움직여
 * 아무것도 잡지 못한다. 여기서는 실제 밀리초를 적어 두고 경계 양쪽을 각각 누른다.
 */
describe('낡은 클레임의 경계', () => {
  const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
  const t0 = new Date('2026-03-01T09:00:00.000Z');
  const at = (offsetMs: number) => new Date(t0.getTime() + offsetMs);

  const claimedJob = async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const claimed = await claimNextJob(t0);
    expect(claimed).not.toBeNull();
    return claimed!;
  };

  it('창의 길이는 15분이다', () => {
    expect(STALE_CLAIM_MS).toBe(FIFTEEN_MINUTES_MS);
    expect(STALE_CLAIM_MS).toBe(900_000);
  });

  /** 아직 렌더 중일 수 있는 잡이다. 여기서 내주면 두 워커가 같은 잡을 민다. */
  it('창 안쪽(1ms 모자람)에서는 다시 내주지 않는다', async () => {
    await claimedJob();
    expect(await claimNextJob(at(FIFTEEN_MINUTES_MS - 1))).toBeNull();
  });

  /** 정확히 15분도 아직 안쪽이다 — 조건은 `>`이지 `>=`가 아니다. */
  it('정확히 경계 위에서도 다시 내주지 않는다', async () => {
    await claimedJob();
    expect(await claimNextJob(at(FIFTEEN_MINUTES_MS))).toBeNull();
  });

  it('창 바깥(1ms 넘김)에서는 같은 잡을 되찾는다', async () => {
    const claimed = await claimedJob();
    const reclaimed = await claimNextJob(at(FIFTEEN_MINUTES_MS + 1));
    expect(reclaimed?.id).toBe(claimed.id);
  });

  /** 되찾을 때 시계가 다시 돈다. 아니면 한 번 낡은 잡이 매 폴링마다 계속 재배정된다. */
  it('되찾으면 창이 되찾은 시각부터 다시 시작한다', async () => {
    const claimed = await claimedJob();
    const reclaimAt = at(FIFTEEN_MINUTES_MS + 1);
    expect((await claimNextJob(reclaimAt))?.claimedAt).toBe(reclaimAt.toISOString());

    // 되찾은 직후부터 다시 15분을 센다 — 첫 클레임 시각(t0)이 아니라.
    expect(await claimNextJob(new Date(reclaimAt.getTime() + FIFTEEN_MINUTES_MS))).toBeNull();
    const again = await claimNextJob(new Date(reclaimAt.getTime() + FIFTEEN_MINUTES_MS + 1));
    expect(again?.id).toBe(claimed.id);
  });

  /** 렌더 중(`rendering`)에 워커가 죽는 것이 실제로 일어나는 경우다. 같은 창을 쓴다. */
  it('rendering 상태에도 같은 창이 적용된다', async () => {
    const claimed = await claimedJob();
    await updateJob(claimed.id, { status: 'rendering', progress: 55 });
    expect(await claimNextJob(at(FIFTEEN_MINUTES_MS))).toBeNull();
    expect((await claimNextJob(at(FIFTEEN_MINUTES_MS + 1)))?.id).toBe(claimed.id);
  });
});
