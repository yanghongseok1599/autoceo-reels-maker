import { NextResponse } from "next/server";
import { createId, mockJobs } from "@/lib/mock-jobs";

type GeneratePayload = {
  format?: "format_a" | "format_d";
  avatarId?: string;
  voiceId?: string;
  voiceAudioUrl?: string;
  script?: string;
  inputMode?: "text" | "audio";
  audioFileName?: string;
  poseGuideName?: string;
  referenceNames?: string[];
};

export async function POST(request: Request) {
  const payload = (await request.json()) as GeneratePayload;

  if (payload.format === "format_d") {
    if (!payload.script?.trim()) {
      return NextResponse.json({ error: "프롬프트가 필요합니다." }, { status: 400 });
    }

    if (!payload.poseGuideName) {
      return NextResponse.json({ error: "포즈 가이드 이미지가 필요합니다." }, { status: 400 });
    }

    if (!payload.referenceNames?.length) {
      return NextResponse.json({ error: "레퍼런스 이미지가 1장 이상 필요합니다." }, { status: 400 });
    }

    const jobId = createId("mock_seedance");
    mockJobs.set(jobId, {
      id: jobId,
      createdAt: Date.now(),
      videoUrl: `mock://autosajang/format-d/${jobId}.mp4`,
    });

    return NextResponse.json({
      jobId,
      status: "processing",
      provider: "seedance_2_0_mock",
      mode: "mock",
    });
  }

  if (!payload.avatarId) {
    return NextResponse.json({ error: "아바타 ID가 필요합니다." }, { status: 400 });
  }

  if (payload.inputMode === "text" && !payload.voiceId) {
    return NextResponse.json({ error: "보이스 ID가 필요합니다." }, { status: 400 });
  }

  if (payload.inputMode === "text" && !payload.script?.trim()) {
    return NextResponse.json({ error: "스크립트가 필요합니다." }, { status: 400 });
  }

  if (payload.inputMode === "text" && payload.script && payload.script.length > 1500) {
    return NextResponse.json({ error: "스크립트는 최대 1500자까지 입력할 수 있습니다." }, { status: 400 });
  }

  if (payload.inputMode === "audio" && !payload.audioFileName) {
    return NextResponse.json({ error: "음성 파일이 필요합니다." }, { status: 400 });
  }

  if (!process.env.HEYGEN_API_KEY) {
    const jobId = createId("mock_video");
    mockJobs.set(jobId, {
      id: jobId,
      createdAt: Date.now(),
      videoUrl: `mock://autosajang/${jobId}.mp4`,
    });

    return NextResponse.json({
      jobId,
      status: "processing",
      mode: "mock",
    });
  }

  return NextResponse.json(
    {
      error: "HeyGen Video Generate 실연동은 API 계약 확인 후 연결해야 합니다.",
    },
    { status: 501 },
  );
}
