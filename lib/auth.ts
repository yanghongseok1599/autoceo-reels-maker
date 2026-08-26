import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { store } from './store';

export interface StudentAccount {
  id: string; name: string; codeHash: string; monthlyRenderCount: number; createdAt: string;
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * 세션 쿠키에 학생 id를 그냥 담으면 인증이 아니라 자기신고가 된다 —
 * 누구든 `student_session=u1`을 보내면 그 학생이 된다. httpOnly는 JS 읽기만 막을 뿐
 * curl이나 devtools로 값을 넣는 걸 막지 못한다. 그래서 서명한다.
 */
function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? '';
}

export function signSession(studentId: string): string {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error('SESSION_SECRET이 설정되지 않았습니다. 세션에 서명할 수 없습니다.');
  }
  const mac = createHmac('sha256', secret).update(studentId).digest('hex');
  return `${studentId}.${mac}`;
}

/** 서명이 맞을 때만 학생 id를 돌려준다. 비밀값이 없으면 아무도 통과시키지 않는다. */
export function readSession(value: string | undefined | null): string | null {
  const secret = sessionSecret();
  if (!value || !secret) return null;

  const cut = value.lastIndexOf('.');
  if (cut <= 0 || cut === value.length - 1) return null;

  const id = value.slice(0, cut);
  const given = Buffer.from(value.slice(cut + 1), 'utf8');
  const expected = Buffer.from(
    createHmac('sha256', secret).update(id).digest('hex'),
    'utf8',
  );

  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? id : null;
}

export async function verifyInviteCode(code: string): Promise<StudentAccount | null> {
  if (!code?.trim()) return null;
  const students = await store.read<StudentAccount[]>('students', []);
  const target = hashCode(code);
  return students.find((s) => s.codeHash === target) ?? null;
}
