import { NextResponse } from "next/server";
import { createLearningRecord, updateLearningRecord, type LearnedFormat } from "@/lib/learning-store";
import { readSessionFromRequest } from "@/lib/auth";

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
  // 기록에는 주인이 있어야 한다. 익명 기록은 누구의 것도 아니게 되고, 주인 없는 기록은
  // 소유자 필터를 통과할 방법이 없다. 소유자는 **세션에서만** 온다 — 위 `ImportPayload`에
  // `ownerId`가 없는 것은 빠뜨린 것이 아니라 본문이 소유자를 정하지 못하게 하는 것이다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

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
    ownerId,
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
  const completedRecord = await updateLearningRecord(ownerId, record.id, {
    status: "completed",
    resultUrl: `higgsfield-upload://${payload.resultFileName}`,
  });

  return NextResponse.json({
    jobId,
    record: completedRecord,
  });
}
