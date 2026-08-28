import { describe, it, expect, beforeEach } from 'vitest';
import { POST as claimRoute } from '../jobs/next/route';
import { PATCH as patchRoute, GET as statusRoute } from '../jobs/[id]/route';
import { enqueueJob, getJob, claimNextJob } from '@/lib/jobs';
import { isWorkerAlive, recordWorkerSeen, WORKER_ALIVE_WINDOW_MS } from '@/lib/worker-liveness';
import { signSession } from '@/lib/auth';
import { resetStoreForTests } from '@/lib/store/file-store';

beforeEach(async () => {
  process.env.WORKER_TOKEN = 'test-token';
  process.env.SESSION_SECRET = 'test-session-secret';
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
    const project = await createProject({
      ownerId: 'u1', script: '무릎 통증 팁', voiceReferenceId: 'voice_u1',
    });
    await enqueueJob({ projectId: project.id, ownerId: 'u1' });
    const body = await (await claimRoute(req('test-token'))).json();
    expect(body.project.script).toBe('무릎 통증 팁');
  });

  // 워커는 전역 env가 아니라 이 응답에서 목소리를 읽는다. 빠지면 학생 목소리가 사라진다.
  it('includes the voice the student chose so the worker can render in it', async () => {
    const { createProject } = await import('@/lib/projects');
    const project = await createProject({
      ownerId: 'u1', script: '대본', voiceReferenceId: 'voice_u1',
    });
    await enqueueJob({ projectId: project.id, ownerId: 'u1' });
    const body = await (await claimRoute(req('test-token'))).json();
    expect(body.project.voiceReferenceId).toBe('voice_u1');
  });

  it('reports a null project rather than hiding the job', async () => {
    await enqueueJob({ projectId: 'gone', ownerId: 'u1' });
    const body = await (await claimRoute(req('test-token'))).json();
    expect(body.job.projectId).toBe('gone');
    expect(body.project).toBeNull();
  });

  /**
   * 폴링 자체가 "워커가 켜져 있다"는 유일한 증거다. 큐가 비어 있어도 기록해야 한다 —
   * 워커가 노는 동안이야말로 수강생이 "왜 안 되지" 하고 화면을 들여다보는 때다.
   */
  it('records the worker as alive even when the queue is empty', async () => {
    expect(await isWorkerAlive()).toBe(false);
    await claimRoute(req('test-token'));
    expect(await isWorkerAlive()).toBe(true);
  });

  /**
   * 토큰 없는 요청으로 생존을 꾸며낼 수 있으면, 이 신호를 근거로 삼는 화면이 다시
   * 거짓말을 하게 된다. 기록은 인증 뒤에만 일어난다.
   */
  it('does not record liveness for an unauthenticated poll', async () => {
    expect((await claimRoute(req('nope'))).status).toBe(401);
    expect(await isWorkerAlive()).toBe(false);
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
  function getReq(id: string, studentId?: string) {
    return new Request(`http://localhost/api/jobs/${id}`, {
      headers: studentId
        ? { cookie: `student_session=${encodeURIComponent(signSession(studentId))}` }
        : {},
    });
  }

  const status = (id: string, studentId?: string) =>
    statusRoute(getReq(id, studentId), { params: Promise.resolve({ id }) });

  it('returns the polling shape the UI needs', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const body = await (await status(job.id, 'u1')).json();
    expect(body).toEqual({
      status: 'queued', progress: 0, resultUrl: null, error: null, workerAlive: false,
    });
  });

  /**
   * 큐에 있는 잡에 붙는 유일한 판단 재료. 이 값이 없으면 화면은 진행률 0을
   * "음성 합성 중"으로 읽는 예전 상태로 돌아간다.
   */
  it('tells the owner a worker has been seen recently', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await recordWorkerSeen();
    expect((await (await status(job.id, 'u1')).json()).workerAlive).toBe(true);
  });

  it('tells the owner when the worker has not been seen for too long', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await recordWorkerSeen(new Date(Date.now() - WORKER_ALIVE_WINDOW_MS - 1000));
    expect((await (await status(job.id, 'u1')).json()).workerAlive).toBe(false);
  });

  /**
   * 이미 집힌 잡에는 묻지 않는다. `false`가 아니라 `null`이어야 한다 — 화면이 그 둘을
   * 같게 읽으면 멀쩡히 렌더 중인 잡에 "렌더 서버 응답 없음"이 뜬다.
   */
  it('does not ask about the worker once the job has been claimed', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await claimNextJob();
    const body = await (await status(job.id, 'u1')).json();
    expect(body.status).toBe('claimed');
    expect(body.workerAlive).toBeNull();
  });

  it('returns 404 for a job that does not exist', async () => {
    expect((await status('nope', 'u1')).status).toBe(404);
  });

  it('rejects an unauthenticated poll', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    expect((await status(job.id)).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await statusRoute(
      new Request(`http://localhost/api/jobs/${job.id}`, { headers: { cookie: 'student_session=u1' } }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(401);
  });

  // 남의 잡은 "없는 잡"으로 답한다 — 403이면 그 id가 존재한다는 걸 알려주는 셈이다.
  it('hides another student\'s job behind a 404', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await recordWorkerSeen();
    const res = await status(job.id, 'u2');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('존재하지 않는 작업입니다.');
    // 워커 생존은 남의 잡 id를 들고 온 사람에게 답할 이유가 없다. 200과 404를 가르는
    // 필드가 하나라도 늘면 그 id가 존재한다는 사실이 샌다.
    expect(body).not.toHaveProperty('workerAlive');
  });

  it('lets the owner poll their own job', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u2' });
    expect((await status(job.id, 'u2')).status).toBe(200);
  });
});
