import { NextResponse } from 'next/server';
import { claimNextJob } from '@/lib/jobs';
import { recordWorkerSeen } from '@/lib/worker-liveness';
import { getProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export function assertWorker(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  if (!expected) return false;
  return request.headers.get('x-worker-token') === expected;
}

export async function POST(request: Request) {
  if (!assertWorker(request)) {
    return NextResponse.json({ error: '인증되지 않은 워커입니다.' }, { status: 401 });
  }
  /**
   * **인증을 통과한 뒤에만** 살아 있다고 기록한다. 앞에 두면 토큰 없는 아무나 워커가 켜져
   * 있는 것처럼 꾸밀 수 있고, 그러면 이 신호를 근거로 "차례를 기다리는 중"을 보여 주는
   * 화면이 다시 거짓말을 하게 된다.
   *
   * 실패는 삼킨다. 하트비트는 진단 신호이고 이 라우트의 본업은 잡을 내주는 것이다.
   * 여기서 던지면 저장소가 잠깐 아픈 것만으로 큐 전체가 멈춘다 — 진단을 켜려다 진단하려던
   * 증상을 만들어 내는 셈이다.
   */
  await recordWorkerSeen().catch(() => {});

  const job = await claimNextJob();
  if (!job) return NextResponse.json({ job: null, project: null });
  const project = await getProject(job.projectId);
  return NextResponse.json({ job, project });
}
