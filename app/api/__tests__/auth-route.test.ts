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
