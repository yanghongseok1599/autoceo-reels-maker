import { NextRequest, NextResponse } from "next/server";
import { createFishVoice } from "@/lib/fish-audio-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "multipart/form-data required" }, { status: 400 });
  }

  const name = String(form.get("name") ?? "").trim();
  const language = String(form.get("language") ?? "ko");
  const referenceText = String(form.get("referenceText") ?? "").trim();
  const file = form.get("sample");

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  if (!referenceText) {
    return NextResponse.json({ error: "샘플 음성에 실제로 말한 대본이 필요합니다." }, { status: 400 });
  }

  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ error: "목소리 샘플 파일이 필요합니다." }, { status: 400 });
  }

  try {
    const filename = file instanceof File && file.name ? file.name : "voice-sample.wav";
    const profile = await createFishVoice({
      name,
      language,
      audio: file,
      filename,
      referenceText,
    });

    return NextResponse.json({
      id: profile.id,
      name: profile.name,
      language: profile.language,
      voiceType: "cloned",
      defaultEngine: "fish",
      sampleCount: profile.sampleCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
