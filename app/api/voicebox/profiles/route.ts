import { NextRequest, NextResponse } from "next/server";
import {
  checkHealth,
  createProfile,
  KOREAN_ENGINE,
  listModels,
  listPresetVoices,
  listProfiles,
} from "@/lib/voicebox-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const [profiles, presetVoices, models, health] = await Promise.all([
    listProfiles(),
    listPresetVoices(KOREAN_ENGINE),
    listModels(),
    checkHealth(),
  ]);

  return NextResponse.json({
    profiles,
    presetVoices,
    models,
    health,
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    name?: string;
    language?: string;
    voiceType?: "preset" | "designed";
    presetEngine?: string;
    presetVoiceId?: string;
    designPrompt?: string;
  };

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  try {
    const profile = await createProfile({
      name: body.name.trim(),
      language: body.language ?? "ko",
      voiceType: body.voiceType ?? "preset",
      presetEngine: body.presetEngine ?? KOREAN_ENGINE,
      presetVoiceId: body.presetVoiceId,
      designPrompt: body.designPrompt,
      defaultEngine: body.presetEngine ?? KOREAN_ENGINE,
    });

    return NextResponse.json(profile);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
