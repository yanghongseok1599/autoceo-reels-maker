import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueJob, claimNextJob, updateJob, getJob, STALE_CLAIM_MS } from '../jobs';
import { resetStoreForTests } from '../store/file-store';

// 실제 .local-data/를 건드리지 않는다 — 거기엔 사용자의 학습 기록이 들어 있다.
beforeEach(async () => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
  await resetStoreForTests();
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
});
