import { NextResponse } from 'next/server';
import { createProject, canRender, chargeRender, MONTHLY_RENDER_LIMIT } from '@/lib/projects';
import { enqueueJob } from '@/lib/jobs';
import { authorizeVoice } from '@/lib/voice-access';
import { getStudent, readSessionFromRequest, saveStudent } from '@/lib/auth';
import { readJsonObject, readString } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const student = await getStudent(ownerId);
  if (!student) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  if (!canRender(student)) {
    return NextResponse.json(
      { error: `이번 달 생성 한도(${MONTHLY_RENDER_LIMIT}편)를 모두 사용했습니다.` },
      { status: 429 },
    );
  }

  /**
   * 못 읽은 본문은 빈 본문과 같다 — 바로 아래 "대본을 입력해주세요"가 그대로 받는다.
   * 문자열이 아닌 값도 없는 것으로 본다: `{"script": 123}`은 `script.trim()`에서,
   * `{"voiceReferenceId": 123}`은 `authorizeVoice`의 `voiceId?.trim()`에서 500이 났다.
   */
  const body = (await readJsonObject(request)) ?? {};
  const script = readString(body.script);
  const voiceReferenceId = readString(body.voiceReferenceId);
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

  /**
   * 자기 계정 하나만 쓴다. 예전에는 `students` 배열 전체를 다시 써서, 이 몇 줄 사이에
   * 만들어진 다른 계정을 지웠다(`lib/auth.ts`의 `studentKey` 주석).
   */
  await saveStudent(chargeRender(student));

  return NextResponse.json({ projectId: project.id, jobId: job.id, status: 'queued' });
}
