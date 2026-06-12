import { NextRequest, NextResponse } from "next/server";
import { addProfileSample, createProfile } from "@/lib/voicebox-client";

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
    const profile = await createProfile({
      name,
      language,
      voiceType: "cloned",
      description: "오토사장 아바타 릴스용 사용자 목소리",
    });
    const filename = file instanceof File && file.name ? file.name : "voice-sample.wav";
    await addProfileSample(profile.id, file, filename, referenceText);

    return NextResponse.json({ ...profile, sampleCount: 1 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
