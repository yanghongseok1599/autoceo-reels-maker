import { NextRequest, NextResponse } from "next/server";
import { generateSpeech } from "@/lib/voicebox-client";
import type { Language, VoiceEngine } from "@/lib/voicebox-types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    text?: string;
    profileId?: string;
    language?: Language;
    engine?: VoiceEngine;
    modelSize?: "1.7B" | "0.6B" | "1B" | "3B";
    seed?: number;
  };

  if (!body.text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (!body.profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const result = await generateSpeech({
    text: body.text,
    profileId: body.profileId,
    language: body.language ?? "ko",
    engine: body.engine,
    modelSize: body.modelSize,
    seed: body.seed,
  });

  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
