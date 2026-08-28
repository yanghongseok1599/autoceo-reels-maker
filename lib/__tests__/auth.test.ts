import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStudent,
  hashCode,
  inviteCodeTaken,
  registerStudent,
  saveStudent,
  signSession,
  readSession,
  readSessionFromRequest,
  SESSION_COOKIE,
  verifyInviteCode,
  STUDENT_INDEX_KEY,
  type StudentAccount,
  type StudentIndexEntry,
} from '../auth';
import { fileStore } from '../store/file-store';

const account = (id: string, code: string): StudentAccount => ({
  id, name: `수강생-${id}`, codeHash: hashCode(code), monthlyRenderCount: 0,
  createdAt: '2026-08-26T00:00:00Z',
});

beforeEach(async () => {
  await registerStudent({ ...account('u1', 'ABC123'), name: '수강생1' });
});

describe('verifyInviteCode', () => {
  it('accepts a valid code', async () => {
    expect((await verifyInviteCode('ABC123'))?.id).toBe('u1');
  });

  it('rejects an unknown code', async () => {
    expect(await verifyInviteCode('WRONG')).toBeNull();
  });

  it('is case insensitive', async () => {
    expect((await verifyInviteCode('abc123'))?.id).toBe('u1');
  });

  it('rejects an empty code', async () => {
    expect(await verifyInviteCode('')).toBeNull();
  });
});

describe('hashCode', () => {
  it('never stores the raw code', () => {
    expect(hashCode('ABC123')).not.toContain('ABC123');
  });
});

// 서명이 없으면 세션 쿠키는 인증이 아니라 자기신고다.
describe('session signing', () => {
  beforeEach(() => { process.env.SESSION_SECRET = 'test-secret'; });

  it('round-trips a signed session', () => {
    expect(readSession(signSession('u1'))).toBe('u1');
  });

  it('rejects a bare student id with no signature', () => {
    expect(readSession('u1')).toBeNull();
  });

  it('rejects a tampered student id', () => {
    const signed = signSession('u1');
    const forged = signed.replace(/^u1\./, 'u2.');
    expect(readSession(forged)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const signed = signSession('u1');
    expect(readSession(`${signed.slice(0, -1)}0`)).toBeNull();
  });

  it('rejects a signature made with a different secret', () => {
    const signed = signSession('u1');
    process.env.SESSION_SECRET = 'other-secret';
    expect(readSession(signed)).toBeNull();
  });

  it('fails closed when SESSION_SECRET is unset', () => {
    const signed = signSession('u1');
    delete process.env.SESSION_SECRET;
    expect(readSession(signed)).toBeNull();
  });

  it('returns null for a missing cookie', () => {
    expect(readSession(undefined)).toBeNull();
    expect(readSession('')).toBeNull();
  });
});

/**
 * 이 계획의 마지막 공유 배열이 `students`였다. 렌더 한 편이 그 배열을 통째로 다시 쓰는
 * 사이에 발급된 계정이 지워졌고, 그 수강생의 초대코드는 영영 듣지 않았다.
 * 계정은 자기 키로, 코드→id 다리만 인덱스로 남긴다.
 */
describe('student keys — 계정 하나에 키 하나', () => {
  const readIndex = () => fileStore.read<StudentIndexEntry[]>(STUDENT_INDEX_KEY, []);

  it('writes each account to its own key, never a shared array', async () => {
    await registerStudent(account('u2', 'DEF456'));
    expect((await getStudent('u1'))?.name).toBe('수강생1');
    expect((await getStudent('u2'))?.name).toBe('수강생-u2');
    // 옛 배열이 되살아나면 갱신 유실도 함께 되살아난다.
    expect(await fileStore.read('students', null)).toBeNull();
  });

  /** 발급이 렌더의 차감과 겹치는 순간을 만든다. 두 쓰기가 서로 다른 키로 가야 한다. */
  it('keeps a new account when a render charge lands at the same time', async () => {
    const before = (await getStudent('u1'))!;
    await Promise.all([
      registerStudent(account('u2', 'DEF456')),
      saveStudent({ ...before, monthlyRenderCount: 7 }),
    ]);
    expect((await verifyInviteCode('DEF456'))?.id).toBe('u2');
    expect((await getStudent('u1'))?.monthlyRenderCount).toBe(7);
  });

  /** 차감은 인덱스를 만지지 않는다 — 만지는 순간 방금 없앤 갱신 유실이 돌아온다. */
  it('does not touch the index when an account record is saved', async () => {
    const before = await readIndex();
    await saveStudent({ ...(await getStudent('u1'))!, monthlyRenderCount: 3 });
    expect(await readIndex()).toEqual(before);
  });

  it('refuses to save an account with no id rather than writing students/.json', async () => {
    await expect(saveStudent(account('', 'GHI789'))).rejects.toThrow(/수강생 id/);
    expect(await getStudent('')).toBeNull();
  });

  it('reports a code as taken only once it is registered', async () => {
    expect(await inviteCodeTaken(hashCode('DEF456'))).toBe(false);
    await registerStudent(account('u2', 'DEF456'));
    expect(await inviteCodeTaken(hashCode('DEF456'))).toBe(true);
  });
});

/**
 * 인덱스는 투영이고 정본은 `students/<id>`다. 어긋났을 때 **인덱스를 믿지 않는다** —
 * 안 그러면 손으로 고친 인덱스 한 줄이 남의 계정으로 로그인시킨다.
 */
describe('verifyInviteCode — 인덱스가 어긋났을 때', () => {
  it('refuses a code whose index entry points at a missing account', async () => {
    await fileStore.write(STUDENT_INDEX_KEY, [
      ...(await fileStore.read<StudentIndexEntry[]>(STUDENT_INDEX_KEY, [])),
      { codeHash: hashCode('GHOST1'), id: 'u-does-not-exist' },
    ]);
    expect(await verifyInviteCode('GHOST1')).toBeNull();
  });

  it('refuses when the account found does not carry that code hash', async () => {
    await registerStudent(account('u2', 'DEF456'));
    // 인덱스가 `ABC123`을 u2로 보내도록 바꾼다. 레코드 재확인이 없으면 u2로 로그인된다.
    await fileStore.write(STUDENT_INDEX_KEY, [{ codeHash: hashCode('ABC123'), id: 'u2' }]);
    expect(await verifyInviteCode('ABC123')).toBeNull();
  });

  it('still accepts every registered code after a second account is added', async () => {
    await registerStudent(account('u2', 'DEF456'));
    expect((await verifyInviteCode('ABC123'))?.id).toBe('u1');
    expect((await verifyInviteCode('DEF456'))?.id).toBe('u2');
  });
});

/**
 * 브라우저는 쿠키를 **하나만** 보내지 않는다. 세션 쿠키는 `theme`·`lang` 사이 아무 자리에나
 * 있고, 이름 앞에는 `; ` 뒤의 공백이 붙으며, 값이 없는 조각이 섞이기도 한다. 검사가 쿠키
 * 하나짜리 헤더만 보면 이름 비교와 두 `trim()`이 한 번도 실행되지 않는다 — 그것들을 통째로
 * 지워도 아무 검사가 실패하지 않는다는 뜻이고, 여기서 열리는 문은 남의 계정이다.
 */
describe('readSessionFromRequest — 쿠키가 여럿인 진짜 헤더', () => {
  const withCookie = (cookie: string) =>
    new Request('http://localhost/api/projects', { headers: { cookie } });

  let signed: string;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-secret';
    signed = signSession('u1');
  });

  it('finds the session even when it is not the first cookie', () => {
    const header = `theme=dark; ${SESSION_COOKIE}=${encodeURIComponent(signed)}; lang=ko`;
    expect(readSessionFromRequest(withCookie(header))).toBe('u1');
  });

  /**
   * `; ` 뒤에는 공백이 남는다. 이름의 `trim()`이 없으면 두 번째 이후의 쿠키는 **영원히**
   * 세션으로 인정되지 않는다 — 로그인한 사람이 로그아웃된 것처럼 보인다.
   */
  it('tolerates the space that follows "; " before the cookie name', () => {
    expect(readSessionFromRequest(withCookie(`a=1;   ${SESSION_COOKIE}=${encodeURIComponent(signed)}`)))
      .toBe('u1');
  });

  /** 값 쪽 공백도 같다. 공백이 붙은 채로 서명을 검증하면 길이가 달라 통과하지 못한다. */
  it('tolerates whitespace around the cookie value', () => {
    expect(readSessionFromRequest(withCookie(`a=1; ${SESSION_COOKIE}= ${encodeURIComponent(signed)} ; b=2`)))
      .toBe('u1');
  });

  /**
   * 이름이 세션 이름을 **포함**할 뿐인 쿠키는 세션이 아니다. 비교가 느슨해지면 아무나
   * `not_student_session`에 남의 서명을 담아 보내는 것으로 그 사람이 된다.
   */
  it('refuses a cookie whose name merely contains the session name', () => {
    expect(readSessionFromRequest(withCookie(`not_${SESSION_COOKIE}=${encodeURIComponent(signed)}`)))
      .toBeNull();
  });

  it('refuses a cookie whose name merely starts with the session name', () => {
    expect(readSessionFromRequest(withCookie(`${SESSION_COOKIE}_backup=${encodeURIComponent(signed)}`)))
      .toBeNull();
  });

  it('skips a cookie part that has no "=" at all', () => {
    expect(readSessionFromRequest(withCookie(`flag; ${SESSION_COOKIE}=${encodeURIComponent(signed)}`)))
      .toBe('u1');
  });

  /**
   * 값 없는 조각의 이름을 잘라 세션 이름과 맞춰 보면 안 된다. 아래 조각은 세션 이름보다
   * 딱 한 글자 길다 — `=`가 없을 때 그냥 넘어가지 않으면 마지막 글자만 떨어져 나가
   * **세션 쿠키로 오인되고**, 진짜 세션 쿠키는 읽히지도 못한 채 요청이 거절된다.
   */
  it('does not mistake a valueless part for the session cookie', () => {
    const header = `${SESSION_COOKIE}0; ${SESSION_COOKIE}=${encodeURIComponent(signed)}`;
    expect(readSessionFromRequest(withCookie(header))).toBe('u1');
  });

  /** 잘못 인코딩된 값은 500이 아니라 거절이다. */
  it('returns null for a malformed percent-encoding instead of throwing', () => {
    expect(() => readSessionFromRequest(withCookie(`${SESSION_COOKIE}=%zz`))).not.toThrow();
    expect(readSessionFromRequest(withCookie(`${SESSION_COOKIE}=%zz`))).toBeNull();
  });

  it('returns null when no cookie in the header is the session', () => {
    expect(readSessionFromRequest(withCookie('theme=dark; lang=ko'))).toBeNull();
  });
});
