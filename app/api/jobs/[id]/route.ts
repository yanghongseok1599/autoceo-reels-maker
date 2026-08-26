import { NextResponse } from 'next/server';
import { updateJob, getJob } from '@/lib/jobs';
import { assertWorker } from '../next/route';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertWorker(request)) {
    return NextResponse.json({ error: '인증되지 않은 워커입니다.' }, { status: 401 });
  }
  const { id } = await params;
  const patch = await request.json();
  const job = await updateJob(id, patch);
  if (!job) return NextResponse.json({ error: '존재하지 않는 작업입니다.' }, { status: 404 });
  return NextResponse.json({ job });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: '존재하지 않는 작업입니다.' }, { status: 404 });
  return NextResponse.json({
    status: job.status, progress: job.progress, resultUrl: job.resultUrl, error: job.error,
  });
}
