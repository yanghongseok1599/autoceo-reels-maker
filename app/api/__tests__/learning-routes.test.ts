import { describe, it, expect, beforeEach } from 'vitest';
import { GET as insightsGet } from '../learning/insights/route';
import { POST as importPost } from '../learning/import/route';
import { POST as feedbackPost } from '../learning/feedback/route';
import { signSession } from '@/lib/auth';

/**
 * 학습 기록에는 **남이 쓴 대본 본문**이 들어 있다. 인사이트의 `bestPrompt`가 그 본문을
 * 그대로 돌려주므로, 세션 검사가 없으면 로그인하지 않은 사람도 다른 수강생의 대본을 읽는다.
 * 여기 있는 검사는 "동시 저장" 이야기가 아니라 그 경계 이야기다.
 *
 * 저장소는 `vitest.setup.ts`가 테스트마다 새 `STORE_DIR`을 주므로 따로 비울 것이 없다.
 */
beforeEach(() => {
  process.env.SESSION_SECRET = 'test-session-secret';
});

function cookieFor(ownerId: string) {
  return { cookie: `student_session=${encodeURIComponent(signSession(ownerId))}` };
}

const get = (url: string, ownerId?: string) =>
  new Request(url, { headers: ownerId ? cookieFor(ownerId) : {} });

const post = (url: string, ownerId: string | undefined, body: unknown) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(ownerId ? cookieFor(ownerId) : {}) },
    body: JSON.stringify(body),
  });

const IMPORT = 'http://localhost/api/learning/import';
const INSIGHTS = 'http://localhost/api/learning/insights?format=format_a';
const FEEDBACK = 'http://localhost/api/learning/feedback';

/**
 * `resultFileName`이 빠지면 라우트가 400에서 멈춰 **기록이 생기지 않는다.** 그러면
 * "남의 대본이 안 보인다"는 검사가 아무것도 저장되지 않은 채 통과하는 빈 검사가 된다.
 */
const importBody = (script: string) => ({
  format: 'format_a' as const,
  script,
  resultFileName: 'result.mp4',
});

const insightsFor = async (ownerId?: string) => {
  const res = await insightsGet(get(INSIGHTS, ownerId));
  return { status: res.status, body: await res.json() };
};

describe('학습 라우트는 세션을 요구한다', () => {
  it('rejects insights without a session', async () => {
    expect((await insightsFor()).status).toBe(401);
  });

  it('rejects import without a session', async () => {
    const res = await importPost(post(IMPORT, undefined, importBody('대본')));
    expect(res.status).toBe(401);
  });

  it('rejects feedback without a session', async () => {
    const res = await feedbackPost(post(FEEDBACK, undefined, { jobId: 'j1', feedback: 'good' }));
    expect(res.status).toBe(401);
  });

  // 쿠키에 학생 id를 그냥 적어 보내는 것은 인증이 아니라 자기신고다.
  it('rejects a forged session cookie', async () => {
    const res = await insightsGet(new Request(INSIGHTS, { headers: { cookie: 'student_session=u1' } }));
    expect(res.status).toBe(401);
  });

  it('says it in Korean, like the rest of the app', async () => {
    const { body } = await insightsFor();
    expect(body.error).toBe('로그인이 필요합니다.');
  });
});

describe('인사이트는 수강생별이다', () => {
  // 이 검사가 결함 그 자체다. 수정 전에는 u2가 u1의 대본 본문을 그대로 받았다.
  it('never returns another student script', async () => {
    await importPost(post(IMPORT, 'u1', importBody('u1만 아는 비밀 대본')));

    const { body } = await insightsFor('u2');
    expect(JSON.stringify(body)).not.toContain('u1만 아는 비밀 대본');
    expect(body.total).toBe(0);
  });

  it('returns a student their own record', async () => {
    await importPost(post(IMPORT, 'u1', importBody('내 대본')));

    const { body } = await insightsFor('u1');
    expect(body.total).toBe(1);
    expect(body.bestPrompt).toBe('내 대본');
  });

  /**
   * 소유자는 **세션에서만** 온다. 본문이 소유자를 정할 수 있으면 세션 검사는 장식이 되고,
   * 누구든 남의 id를 적어 남의 기록을 만들거나 읽는다.
   */
  it('ignores an ownerId in the request body', async () => {
    await importPost(post(IMPORT, 'u1', { ...importBody('세션이 정한다'), ownerId: 'u2' }));

    expect((await insightsFor('u2')).body.total).toBe(0);
    expect((await insightsFor('u1')).body.total).toBe(1);
  });
});

describe('평가도 자기 기록에만 닿는다', () => {
  it("never lets one student rate another student's record", async () => {
    const created = await (await importPost(post(IMPORT, 'u1', importBody('내 대본')))).json();
    const recordId = created.record.id as string;

    const res = await feedbackPost(post(FEEDBACK, 'u2', { learningRecordId: recordId, feedback: 'bad' }));
    expect(res.status).toBe(404);

    // u1의 기록은 손대지 않은 채로 남는다.
    expect((await insightsFor('u1')).body.bad).toBe(0);
  });

  it('lets a student rate their own record', async () => {
    const created = await (await importPost(post(IMPORT, 'u1', importBody('내 대본')))).json();
    const res = await feedbackPost(
      post(FEEDBACK, 'u1', { learningRecordId: created.record.id, feedback: 'good' }),
    );

    expect(res.status).toBe(200);
    expect((await insightsFor('u1')).body.good).toBe(1);
  });
});
