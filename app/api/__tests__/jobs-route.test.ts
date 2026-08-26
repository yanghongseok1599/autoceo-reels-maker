import { describe, it, expect, beforeEach } from 'vitest';
import { POST as claimRoute } from '../jobs/next/route';
import { enqueueJob } from '@/lib/jobs';
import { resetStoreForTests } from '@/lib/store/file-store';

beforeEach(async () => {
  process.env.WORKER_TOKEN = 'test-token';
  await resetStoreForTests();
});

function req(token?: string) {
  return new Request('http://localhost/api/jobs/next', {
    method: 'POST',
    headers: token ? { 'x-worker-token': token } : {},
  });
}

describe('POST /api/jobs/next', () => {
  it('rejects a request with no token', async () => {
    expect((await claimRoute(req())).status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    expect((await claimRoute(req('nope'))).status).toBe(401);
  });

  it('returns null when the queue is empty', async () => {
    const res = await claimRoute(req('test-token'));
    expect(res.status).toBe(200);
    expect((await res.json()).job).toBeNull();
  });

  it('hands out a queued job', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await claimRoute(req('test-token'));
    expect((await res.json()).job.projectId).toBe('p1');
  });

  it('includes the project so the worker has the script', async () => {
    const { createProject } = await import('@/lib/projects');
    const project = await createProject({ ownerId: 'u1', script: '무릎 통증 팁' });
    await enqueueJob({ projectId: project.id, ownerId: 'u1' });
    const body = await (await claimRoute(req('test-token'))).json();
    expect(body.project.script).toBe('무릎 통증 팁');
  });
});
