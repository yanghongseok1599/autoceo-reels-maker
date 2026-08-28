import { NextResponse } from 'next/server';
import { SESSION_COOKIE, signSession, verifyInviteCode } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * 로그인은 **세션 없이 아무나 부를 수 있는 유일한 자리다.** 그래서 본문도 아무 바이트나
 * 들어온다. `request.json()`을 그냥 부르면 JSON이 아닌 본문에 500이 나가는데, 그건
 * "서버가 깨졌다"는 신호를 그냥 틀린 요청에 주는 것이다 — 로그에 진짜 장애와 섞이고,
 * 부르는 쪽에는 다시 눌러 볼 이유를 준다.
 *
 * 못 읽은 본문은 **틀린 코드와 똑같이** 다룬다. 형식이 틀린 것과 코드가 틀린 것을 갈라
 * 알려 줄 이유가 없다 — 수강생에게는 어차피 같은 한 가지 할 일("코드를 다시 확인하세요")
 * 이고, 코드를 찍어 보는 쪽에는 나눠 줄수록 단서만 된다.
 */
async function readInviteCode(request: Request): Promise<string> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return '';
  }
  if (typeof body !== 'object' || body === null) return '';
  const { code } = body as { code?: unknown };
  return typeof code === 'string' ? code : '';
}

export async function POST(request: Request) {
  const student = await verifyInviteCode(await readInviteCode(request));
  if (!student) {
    return NextResponse.json({ error: '초대코드가 올바르지 않습니다.' }, { status: 401 });
  }
  const res = NextResponse.json({ id: student.id, name: student.name });
  res.cookies.set(SESSION_COOKIE, signSession(student.id), {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
