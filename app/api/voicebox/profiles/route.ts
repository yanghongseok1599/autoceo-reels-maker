import { NextRequest, NextResponse } from "next/server";
import { fishConfigured, listFishProfiles } from "@/lib/fish-audio-client";
import { readSessionFromRequest } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // 목록은 호출자 것만. 세션이 없으면 "누구 것"을 정할 수 없으므로 목록도 없다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const fishProfiles = await listFishProfiles(ownerId);
  const profiles = fishProfiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
    language: profile.language,
    voiceType: "cloned",
    defaultEngine: "fish",
    generationCount: 0,
    sampleCount: profile.sampleCount,
  }));

  return NextResponse.json({
    profiles,
    presetVoices: [],
    models: [{ modelName: "fish-audio", displayName: "Fish Audio", downloaded: true, downloading: false, loaded: fishConfigured() }],
    health: {
      reachable: fishConfigured(),
      modelLoaded: fishConfigured(),
      gpu: "Fish Audio API",
      error: fishConfigured() ? undefined : "FISH_API_KEY missing",
    },
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
    return NextResponse.json(
      { error: "Fish Audio에서는 목소리 샘플 파일을 업로드해서 모델을 생성해야 합니다." },
      { status: 400 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
