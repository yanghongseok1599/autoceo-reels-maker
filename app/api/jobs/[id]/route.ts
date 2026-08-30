import { NextResponse } from 'next/server';
import { updateJob, getJob, type RenderJob } from '@/lib/jobs';
import { readSessionFromRequest } from '@/lib/auth';
import { assertWorker } from '../next/route';
import { readJsonObject } from '@/lib/request-body';
import { isWorkerAlive } from '@/lib/worker-liveness';

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
  /**
   * 화면이 이미 1초마다 두드리는 자리다. 워커 생존을 여기 실어 보내면 폴링 루프가 하나로
   * 유지된다.
   *
   * **소유자 확인을 통과한 뒤에** 묻는다. 값 자체는 워커 하나에 대한 사실이라 남의 잡을
   * 알려 주지 않지만, 남의 잡 id로 200이 나가는 순간 그 id가 존재한다는 사실이 새기 때문에
   * 위의 404보다 앞설 수는 없다.
   *
   * 큐에 있을 때만 읽는다. 이미 집힌 잡에는 화면이 이 값을 쓰지 않으므로, 렌더가 도는
   * 몇 분 동안 초당 한 번씩 저장소를 읽을 이유가 없다. 안 물어봤을 때는 `false`가 아니라
   * `null`이다 — "워커가 없다"와 "묻지 않았다"는 다른 말이고, 화면이 그 둘을 같게 읽으면
   * 멀쩡한 렌더 중에 경고가 뜬다.
   */
  const workerAlive = job.status === 'queued' ? await isWorkerAlive() : null;

  return NextResponse.json({
    status: job.status, progress: job.progress, resultUrl: job.resultUrl, error: job.error,
    workerAlive,
  });
}
