import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueJob, claimNextJob, updateJob, getJob, STALE_CLAIM_MS } from '../jobs';
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
