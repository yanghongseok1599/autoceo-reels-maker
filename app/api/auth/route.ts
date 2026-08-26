import { NextResponse } from 'next/server';
import { SESSION_COOKIE, signSession, verifyInviteCode } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { code } = (await request.json()) as { code?: string };
  const student = await verifyInviteCode(code ?? '');
  if (!student) {
    return NextResponse.json({ error: '초대코드가 올바르지 않습니다.' }, { status: 401 });
  }
  const res = NextResponse.json({ id: student.id, name: student.name });
  res.cookies.set(SESSION_COOKIE, signSession(student.id), {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
