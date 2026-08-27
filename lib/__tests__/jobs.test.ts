import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
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
