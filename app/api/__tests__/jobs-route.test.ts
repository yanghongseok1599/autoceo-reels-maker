import { describe, it, expect, beforeEach } from 'vitest';
import { POST as claimRoute } from '../jobs/next/route';
import { PATCH as patchRoute, GET as statusRoute } from '../jobs/[id]/route';
import { enqueueJob, getJob } from '@/lib/jobs';
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

  it('reports a null project rather than hiding the job', async () => {
    await enqueueJob({ projectId: 'gone', ownerId: 'u1' });
    const body = await (await claimRoute(req('test-token'))).json();
    expect(body.job.projectId).toBe('gone');
    expect(body.project).toBeNull();
  });
});

describe('PATCH /api/jobs/[id]', () => {
  function patchReq(id: string, token: string | undefined, body: unknown) {
    return new Request(`http://localhost/api/jobs/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-worker-token': token } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects a request with no token', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await patchRoute(patchReq(job.id, undefined, { progress: 50 }), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a job that does not exist', async () => {
    const res = await patchRoute(patchReq('nope', 'test-token', { progress: 50 }), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('records progress reported by the worker', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await patchRoute(patchReq(job.id, 'test-token', { status: 'rendering', progress: 42 }), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(res.status).toBe(200);
    expect((await getJob(job.id))?.progress).toBe(42);
    expect((await getJob(job.id))?.status).toBe('rendering');
  });

  it('records the result url on completion', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await patchRoute(patchReq(job.id, 'test-token', {
      status: 'completed', progress: 100, resultUrl: '/out/a.mp4',
    }), { params: Promise.resolve({ id: job.id }) });
    const stored = await getJob(job.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.resultUrl).toBe('/out/a.mp4');
  });
});

describe('GET /api/jobs/[id]', () => {
  function getReq(id: string) {
    return new Request(`http://localhost/api/jobs/${id}`);
  }

  it('returns the polling shape the UI needs', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const body = await (await statusRoute(getReq(job.id), {
      params: Promise.resolve({ id: job.id }),
    })).json();
    expect(body).toEqual({ status: 'queued', progress: 0, resultUrl: null, error: null });
  });

  it('returns 404 for a job that does not exist', async () => {
    const res = await statusRoute(getReq('nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
