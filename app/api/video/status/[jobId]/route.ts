import { NextResponse } from "next/server";
import { mockJobs } from "@/lib/mock-jobs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const job = mockJobs.get(jobId);

  if (!job) {
    return NextResponse.json({ error: "존재하지 않는 영상 작업입니다." }, { status: 404 });
  }

  const elapsedSeconds = Math.floor((Date.now() - job.createdAt) / 1000);
  const progress = Math.min(100, 18 + elapsedSeconds * 22);

  if (progress >= 100) {
    return NextResponse.json({
      status: "completed",
      progress: 100,
      videoUrl: job.videoUrl,
    });
  }

  return NextResponse.json({
    status: "processing",
    progress,
  });
}
