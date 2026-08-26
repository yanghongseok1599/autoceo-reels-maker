import { describe, it, expect, beforeEach } from 'vitest';
import { hashCode, verifyInviteCode, signSession, readSession } from '../auth';
import { fileStore } from '../store/file-store';

beforeEach(async () => {
  await fileStore.write('students', [
    { id: 'u1', name: '수강생1', codeHash: hashCode('ABC123'), monthlyRenderCount: 0, createdAt: '2026-08-26T00:00:00Z' },
  ]);
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
