import { describe, it, expect, beforeEach } from 'vitest';
import { POST as loginRoute } from '../auth/route';
import {
  hashCode,
  readSession,
  registerStudent,
  SESSION_COOKIE,
  type StudentAccount,
} from '@/lib/auth';

const account = (id: string, name: string, code: string): StudentAccount => ({
  id,
  name,
  codeHash: hashCode(code),
  monthlyRenderCount: 0,
  createdAt: '2026-08-26T00:00:00Z',
});

beforeEach(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  // 저장소는 `vitest.setup.ts`가 테스트마다 새 `STORE_DIR`을 준다.
  await registerStudent(account('u1', '수강생1', 'ABC123'));
  await registerStudent(account('u2', '수강생2', 'DEF456'));
});

const login = (body: unknown) =>
  loginRoute(
    new Request('http://localhost/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

type LoginResponse = Awaited<ReturnType<typeof loginRoute>>;
const sessionCookie = (res: LoginResponse) => res.cookies.get(SESSION_COOKIE);

describe('POST /api/auth — 초대코드 로그인', () => {
  it('accepts a valid invite code and answers with that student', async () => {
    const res = await login({ code: 'ABC123' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'u1', name: '수강생1' });
  });

  /** 코드마다 주인이 다르다 — 아무나 첫 계정으로 로그인시키지 않는다는 증거. */
  it('logs in the student the code belongs to, not merely the first account', async () => {
    const res = await login({ code: 'DEF456' });
    expect(await res.json()).toEqual({ id: 'u2', name: '수강생2' });
    expect(readSession(sessionCookie(res)!.value)).toBe('u2');
  });

  /** 계정 레코드에는 코드 해시가 들어 있다. 응답에 통째로 실어 보내지 않는다. */
  it('answers with only the id and name, never the stored code hash', async () => {
    const res = await login({ code: 'ABC123' });
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['id', 'name']);
    expect(JSON.stringify(body)).not.toContain(hashCode('ABC123'));
  });
});

/**
 * 쿠키의 속성은 로그인 응답에서 **한 번** 정해지고 그 뒤로는 아무도 다시 보지 않는다.
 * `httpOnly`가 빠지면 페이지에 끼어든 스크립트가 세션을 읽어 가고, `secure`가 빠지면
 * 평문 http로 새어 나가며, `path`가 좁아지면 로그인은 되는데 아무 요청도 인증되지 않는다.
 * 어느 것도 다른 검사가 대신 잡아 주지 않는다.
 */
describe('POST /api/auth — 세션 쿠키의 속성', () => {
  it('sets a session cookie that verifies back to that student', async () => {
    const res = await login({ code: 'ABC123' });
    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();
    expect(readSession(cookie!.value)).toBe('u1');
  });

  /** 서명하지 않은 쿠키는 인증이 아니라 자기신고다(`lib/auth.ts`). */
  it('signs the cookie rather than putting the bare student id in it', async () => {
    const cookie = sessionCookie(await login({ code: 'ABC123' }));
    expect(cookie!.value).not.toBe('u1');
    expect(cookie!.value.startsWith('u1.')).toBe(true);
  });

  it('marks the session cookie httpOnly so page scripts cannot read it', async () => {
    const res = await login({ code: 'ABC123' });
    expect(sessionCookie(res)!.httpOnly).toBe(true);
    expect(res.headers.get('set-cookie')).toMatch(/;\s*HttpOnly/i);
  });

  it('marks the session cookie secure so it never travels over plain http', async () => {
    const res = await login({ code: 'ABC123' });
    expect(sessionCookie(res)!.secure).toBe(true);
    expect(res.headers.get('set-cookie')).toMatch(/;\s*Secure/i);
  });

  it('sets SameSite=lax on the session cookie', async () => {
    const res = await login({ code: 'ABC123' });
    expect(sessionCookie(res)!.sameSite).toBe('lax');
    expect(res.headers.get('set-cookie')).toMatch(/;\s*SameSite=lax/i);
  });

  it('scopes the session cookie to the whole site', async () => {
    const res = await login({ code: 'ABC123' });
    expect(sessionCookie(res)!.path).toBe('/');
    expect(res.headers.get('set-cookie')).toMatch(/;\s*Path=\/(;|$)/);
  });

  it('expires the session cookie after 30 days', async () => {
    const res = await login({ code: 'ABC123' });
    expect(sessionCookie(res)!.maxAge).toBe(60 * 60 * 24 * 30);
    expect(res.headers.get('set-cookie')).toMatch(/;\s*Max-Age=2592000/);
  });
});

describe('POST /api/auth — 거절', () => {
  it('rejects a wrong code with 401 and the Korean copy', async () => {
    const res = await login({ code: 'NOPE99' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '초대코드가 올바르지 않습니다.' });
  });

  it('sets no session cookie when the code is wrong', async () => {
    const res = await login({ code: 'NOPE99' });
    expect(sessionCookie(res)).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rejects a blank code', async () => {
    const res = await login({ code: '   ' });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('초대코드가 올바르지 않습니다.');
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('rejects an empty code', async () => {
    const res = await login({ code: '' });
    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toBeUndefined();
  });

  it('rejects a body with no code field at all', async () => {
    const res = await login({});
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('초대코드가 올바르지 않습니다.');
    expect(sessionCookie(res)).toBeUndefined();
  });

  /** 코드 원문이 아니라 해시를 보내도 통하지 않는다 — 인덱스 값을 그대로 열쇠로 쓰지 못한다. */
  it('refuses the stored hash itself as if it were the code', async () => {
    const res = await login({ code: hashCode('ABC123') });
    expect(res.status).toBe(401);
  });
});

/**
 * 로그인은 세션 없이 아무나 부를 수 있는 유일한 라우트다. 본문 파싱을 감싸지 않으면
 * **JSON이 아닌 아무 바이트나 500을 만든다** — 틀린 요청이 장애처럼 보이고, 로그에서는
 * 진짜 장애와 섞이며, 코드를 찍어 보는 쪽에는 "이 본문은 형식이 달랐다"는 단서가 된다.
 *
 * 못 읽은 본문은 **틀린 코드와 완전히 같은 응답**을 받는다: 401 + 같은 한국어 문구 +
 * 세션 쿠키 없음. 상태코드나 문구가 갈리면 그 차이 자체가 신호가 된다.
 */
describe('POST /api/auth — 망가진 본문', () => {
  const raw = (body: BodyInit | null, headers: HeadersInit = { 'Content-Type': 'application/json' }) =>
    loginRoute(new Request('http://localhost/api/auth', { method: 'POST', body, headers }));

  const rejected = async (res: LoginResponse) => {
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: '초대코드가 올바르지 않습니다.' });
    expect(sessionCookie(res)).toBeUndefined();
    expect(res.headers.get('set-cookie')).toBeNull();
  };

  it('JSON이 아닌 본문을 500이 아니라 401로 거절한다', async () => {
    await rejected(await raw('이건 JSON이 아닙니다'));
  });

  it('중간에 끊긴 JSON도 401로 거절한다', async () => {
    await rejected(await raw('{"code": "ABC123"'));
  });

  it('빈 본문도 401로 거절한다', async () => {
    await rejected(await raw(''));
  });

  it('본문이 아예 없어도 401로 거절한다', async () => {
    await rejected(await raw(null));
  });

  /** `JSON.parse`는 통과하지만 객체가 아닌 값들 — 여기서도 구조분해가 터지면 안 된다. */
  it('객체가 아닌 JSON(null·문자열·숫자·배열)도 401로 거절한다', async () => {
    for (const body of ['null', '"ABC123"', '123', '[]', 'true']) {
      await rejected(await raw(body));
    }
  });

  /** 코드 자리에 문자열이 아닌 값이 오면 `verifyInviteCode`의 `.trim()`이 터진다. */
  it('code가 문자열이 아니면 401로 거절한다', async () => {
    for (const body of ['{"code": 123}', '{"code": null}', '{"code": {}}', '{"code": ["ABC123"]}']) {
      await rejected(await raw(body));
    }
  });

  /** 헤더가 틀렸다고 500이 되지도, 반대로 검사를 건너뛰지도 않는다. */
  it('Content-Type이 틀려도 본문이 JSON이면 그대로 통한다', async () => {
    const res = await raw(JSON.stringify({ code: 'ABC123' }), { 'Content-Type': 'text/plain' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: 'u1', name: '수강생1' });
  });

  /** 망가진 본문 뒤에도 멀쩡한 로그인은 계속 된다 — 라우트가 상태를 망가뜨리지 않는다. */
  it('망가진 요청 다음에도 정상 로그인은 그대로 된다', async () => {
    await rejected(await raw('%%%'));
    const res = await login({ code: 'ABC123' });
    expect(res.status).toBe(200);
    expect(readSession(sessionCookie(res)!.value)).toBe('u1');
  });
});
