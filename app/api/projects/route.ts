import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createProject, canRender, MONTHLY_RENDER_LIMIT } from '@/lib/projects';
import { enqueueJob } from '@/lib/jobs';
import { store } from '@/lib/store';
import { readSession, type StudentAccount } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ownerId = readSession((await cookies()).get('student_session')?.value);
  if (!ownerId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const students = await store.read<StudentAccount[]>('students', []);
  const student = students.find((s) => s.id === ownerId);
  if (!student) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  if (!canRender(student)) {
    return NextResponse.json(
      { error: `이번 달 생성 한도(${MONTHLY_RENDER_LIMIT}편)를 모두 사용했습니다.` },
      { status: 429 },
    );
  }

  const { script } = (await request.json()) as { script?: string };
  if (!script?.trim()) {
    return NextResponse.json({ error: '대본을 입력해주세요.' }, { status: 400 });
  }
  if (script.length > 1500) {
    return NextResponse.json({ error: '대본은 최대 1500자까지 입력할 수 있습니다.' }, { status: 400 });
  }

  const project = await createProject({ ownerId, script });
  const job = await enqueueJob({ projectId: project.id, ownerId });

  await store.write('students', students.map((s) =>
    s.id === ownerId ? { ...s, monthlyRenderCount: s.monthlyRenderCount + 1 } : s));

  return NextResponse.json({ projectId: project.id, jobId: job.id, status: 'queued' });
}
