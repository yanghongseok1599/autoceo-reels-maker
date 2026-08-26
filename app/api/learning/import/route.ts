import { NextResponse } from "next/server";
import { createLearningRecord, updateLearningRecord, type LearnedFormat } from "@/lib/learning-store";

type ImportPayload = {
  format?: LearnedFormat;
  script?: string;
  duration?: string;
  quality?: string;
  platform?: string;
  captionMode?: string;
  poseGuideName?: string;
  referenceNames?: string[];
  resultFileName?: string;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as ImportPayload;

  if (payload.format !== "format_a" && payload.format !== "format_d") {
    return NextResponse.json({ error: "지원하지 않는 포맷입니다." }, { status: 400 });
  }

  if (!payload.script?.trim()) {
    return NextResponse.json({ error: "프롬프트가 필요합니다." }, { status: 400 });
  }

  if (!payload.resultFileName?.trim()) {
    return NextResponse.json({ error: "완성된 MP4 파일명이 필요합니다." }, { status: 400 });
  }

  const jobId = `higgsfield_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const record = await createLearningRecord({
    jobId,
    format: payload.format,
    script: payload.script,
    duration: payload.duration,
    quality: payload.quality,
    platform: payload.platform,
    captionMode: payload.captionMode,
    poseGuideName: payload.poseGuideName,
    referenceNames: payload.referenceNames,
  });
  const completedRecord = await updateLearningRecord(record.id, {
    status: "completed",
    resultUrl: `higgsfield-upload://${payload.resultFileName}`,
  });

  return NextResponse.json({
    jobId,
    record: completedRecord,
  });
}
