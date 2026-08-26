import { NextResponse } from 'next/server';
import { claimNextJob } from '@/lib/jobs';
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
  const job = await claimNextJob();
  if (!job) return NextResponse.json({ job: null, project: null });
  const project = await getProject(job.projectId);
  return NextResponse.json({ job, project });
}
