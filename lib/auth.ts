import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { store } from './store';

export interface StudentAccount {
  id: string; name: string; codeHash: string; monthlyRenderCount: number; createdAt: string;
  /** `monthlyRenderCount`가 속한 달(`YYYY-MM`). 없으면 이번 달로 본다 — `lib/projects.ts` 참고. */
  renderPeriod?: string;
}

export const SESSION_COOKIE = 'student_session';

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

/**
 * `next/headers`의 `cookies()`는 요청 스코프 밖에서 던지므로 라우트 핸들러 단위 테스트에서
 * 쓸 수 없다. 요청 헤더를 직접 읽으면 실제 동작은 같고 테스트가 가능해진다.
 */
export function readSessionFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const cut = part.indexOf('=');
    if (cut < 0) continue;
    if (part.slice(0, cut).trim() !== SESSION_COOKIE) continue;
    const raw = part.slice(cut + 1).trim();
    // 잘못 인코딩된 값(`%zz`)에 decodeURIComponent가 던진다 — 그건 500이 아니라 거절이어야 한다.
    try {
      return readSession(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return null;
}

export async function verifyInviteCode(code: string): Promise<StudentAccount | null> {
  if (!code?.trim()) return null;
  const students = await store.read<StudentAccount[]>('students', []);
  const target = hashCode(code);
  return students.find((s) => s.codeHash === target) ?? null;
}
