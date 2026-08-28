import { NextResponse } from "next/server";
import { synthesizeFishSpeech } from "@/lib/fish-audio-client";
import { readSessionFromRequest } from "@/lib/auth";
import { authorizeVoice } from "@/lib/voice-access";
import { readJsonObject, readString } from "@/lib/request-body";

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

  // generate와 같은 처리. 못 읽은 본문은 빈 본문과 같고, 문자열이 아닌 `text`·`profileId`도
  // 없는 것으로 본다 — 둘 다 `.trim()`에서 500이 나던 자리다.
  const body = (await readJsonObject(request)) ?? {};
  const text = readString(body.text);
  const profileId = readString(body.profileId);

  if (!text?.trim()) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  if (!profileId) {
    return NextResponse.json({ error: "profileId is required" }, { status: 400 });
  }

  const voice = await authorizeVoice(ownerId, profileId);
  if (!voice.ok) return NextResponse.json({ error: voice.error }, { status: voice.status });

  const result = await synthesizeFishSpeech({
    text,
    referenceId: voice.voiceId,
    instruct: readString(body.instruct),
  });

  if (result.status === "error" || !result.generationId) {
    return NextResponse.json(result, { status: 502 });
  }

  return NextResponse.json({ generationId: result.generationId, status: "completed", audioUrl: result.audioUrl });
}
