import { NextResponse } from 'next/server';
import { createProject, canRender, chargeRender, MONTHLY_RENDER_LIMIT } from '@/lib/projects';
import { enqueueJob } from '@/lib/jobs';
import { authorizeVoice } from '@/lib/voice-access';
import { store } from '@/lib/store';
import { readSessionFromRequest, type StudentAccount } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ownerId = readSessionFromRequest(request);
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

  const { script, voiceReferenceId } = (await request.json()) as {
    script?: string;
    voiceReferenceId?: string;
  };
  if (!script?.trim()) {
    return NextResponse.json({ error: '대본을 입력해주세요.' }, { status: 400 });
  }
  if (script.length > 1500) {
    return NextResponse.json({ error: '대본은 최대 1500자까지 입력할 수 있습니다.' }, { status: 400 });
  }

  /**
   * 목소리는 **여기서** 검증한다. 워커까지 내려가면 이미 늦다 — 그때는 학생의 이번 달
   * 생성 횟수가 깎인 뒤다. 그리고 기본 목소리로 대체하지 않는다: 조용히 운영자 목소리로
   * 바꿔치기하는 것이 지금 고치고 있는 바로 그 버그다.
   */
  const voice = await authorizeVoice(ownerId, voiceReferenceId);
  if (!voice.ok) return NextResponse.json({ error: voice.error }, { status: voice.status });

  const project = await createProject({ ownerId, script, voiceReferenceId: voice.voiceId });
  const job = await enqueueJob({ projectId: project.id, ownerId });

  await store.write('students', students.map((s) => (s.id === ownerId ? chargeRender(s) : s)));

  return NextResponse.json({ projectId: project.id, jobId: job.id, status: 'queued' });
}
