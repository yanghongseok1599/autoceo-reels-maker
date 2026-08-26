import { NextResponse } from "next/server";
import { createFishVoice } from "@/lib/fish-audio-client";
import { readSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  // 목소리에는 주인이 있어야 한다. 익명 클론은 누구의 것도 아니게 되고,
  // 주인 없는 기록은 소유자 필터를 통과할 방법이 없다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

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
      ownerId,
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
