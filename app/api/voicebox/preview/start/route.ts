import { NextResponse } from "next/server";
import { synthesizeFishSpeech } from "@/lib/fish-audio-client";
import { readSessionFromRequest } from "@/lib/auth";
import { authorizeVoice } from "@/lib/voice-access";
import type { Language } from "@/lib/voicebox-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  /**
   * 목록만 막고 합성을 열어두면 경계가 아니다 — id만 알면 남의 클론 목소리로
   * 아무 문장이나 만들 수 있었다. 그건 사칭이다.
   */
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const body = (await request.json()) as {
    text?: string;
    profileId?: string;
    language?: Language;
    instruct?: string;
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
    instruct: body.instruct,
  });

  if (result.status === "error" || !result.generationId) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json({ generationId: result.generationId, status: "completed", audioUrl: result.audioUrl });
}
