import { NextResponse } from "next/server";
import { createId } from "@/lib/mock-jobs";

export async function POST(request: Request) {
  const formData = await request.formData();
  const voice = formData.get("voice");

  if (!(voice instanceof File)) {
    return NextResponse.json({ error: "음성 파일이 필요합니다." }, { status: 400 });
  }

  if (!["audio/wav", "audio/mpeg", "audio/mp3"].includes(voice.type)) {
    return NextResponse.json({ error: "WAV 또는 MP3 파일만 업로드할 수 있습니다." }, { status: 400 });
  }

  if (!process.env.HEYGEN_API_KEY) {
    return NextResponse.json({
      voiceId: createId("mock_voice"),
      mode: "mock",
    });
  }

  return NextResponse.json(
    {
      error: "HeyGen Voice Clone 실연동은 API 계약 확인 후 연결해야 합니다.",
    },
    { status: 501 },
  );
}
