import { NextResponse } from 'next/server';
import { updateJob, getJob, type RenderJob } from '@/lib/jobs';
import { readSessionFromRequest } from '@/lib/auth';
import { assertWorker } from '../next/route';
import { readJsonObject } from '@/lib/request-body';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertWorker(request)) {
    return NextResponse.json({ error: '인증되지 않은 워커입니다.' }, { status: 401 });
  }
  const { id } = await params;
  /**
   * 여기만 다른 다섯 라우트와 답이 다르다. 저쪽은 못 읽은 본문을 "빈 요청"으로 보고
   * 이미 있는 400을 태우면 되지만, 갱신은 **빈 패치가 곧 성공**이다 — `{...job, ...{}}`는
   * 잡을 그대로 다시 쓰고 200을 낸다. 예전에는 `null`·`123`·`"x"`·`[]`가 정확히 그렇게
   * 조용히 200을 받았고, 워커 쪽 버그가 진행률을 영영 못 쓰는 것으로만 드러났을 것이다.
   * 읽지 못한 본문은 거절한다.
   */
  const patch = await readJsonObject(request);
  if (!patch) {
    return NextResponse.json({ error: '작업 갱신 내용을 읽을 수 없습니다.' }, { status: 400 });
  }
  const job = await updateJob(id, patch as Partial<Pick<RenderJob, 'status' | 'progress' | 'resultUrl' | 'error'>>);
  if (!job) return NextResponse.json({ error: '존재하지 않는 작업입니다.' }, { status: 404 });
  return NextResponse.json({ job });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const { id } = await params;
  const job = await getJob(id);
  /**
   * 남의 잡은 "없는 잡"으로 답한다. 403을 주면 그 id가 존재한다는 사실을 알려주는 꼴이다.
   */
  if (!job || job.ownerId !== ownerId) {
    return NextResponse.json({ error: '존재하지 않는 작업입니다.' }, { status: 404 });
  }
  return NextResponse.json({
    status: job.status, progress: job.progress, resultUrl: job.resultUrl, error: job.error,
  });
}
