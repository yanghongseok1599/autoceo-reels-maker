import { NextResponse } from "next/server";
import { synthesizeFishSpeech } from "@/lib/fish-audio-client";
import { readSessionFromRequest } from "@/lib/auth";
import { authorizeVoice } from "@/lib/voice-access";
import type { Language, VoiceEngine } from "@/lib/voicebox-types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  // preview/start와 같은 경계. 목소리 id를 받는 라우트는 예외 없이 소유권을 확인한다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as {
    text?: string;
    profileId?: string;
    language?: Language;
    engine?: VoiceEngine;
    modelSize?: "1.7B" | "0.6B" | "1B" | "3B";
    seed?: number;
    instruct?: string;
    speakingSpeed?: number;
  };

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (!body.profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const voice = await authorizeVoice(ownerId, body.profileId);
  if (!voice.ok) return NextResponse.json({ error: voice.error }, { status: voice.status });

  const result = await synthesizeFishSpeech({
    text: body.text,
    referenceId: voice.voiceId,
    speakingSpeed: body.speakingSpeed,
    instruct: body.instruct,
  });

  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
