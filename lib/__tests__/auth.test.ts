import { describe, it, expect, beforeEach } from 'vitest';
import {
  getStudent,
  hashCode,
  inviteCodeTaken,
  registerStudent,
  saveStudent,
  signSession,
  readSession,
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
