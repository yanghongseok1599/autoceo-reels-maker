import { NextRequest, NextResponse } from "next/server";
import { synthesizeFishSpeech } from "@/lib/fish-audio-client";
import type { Language } from "@/lib/voicebox-types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
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

  const result = await synthesizeFishSpeech({
    text: body.text,
    referenceId: body.profileId,
    instruct: body.instruct,
  });

  if (result.status === "error" || !result.generationId) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json({ generationId: result.generationId, status: "completed", audioUrl: result.audioUrl });
}
