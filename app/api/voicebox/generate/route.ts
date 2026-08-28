import { NextResponse } from "next/server";
import { synthesizeFishSpeech } from "@/lib/fish-audio-client";
import { readSessionFromRequest } from "@/lib/auth";
import { authorizeVoice } from "@/lib/voice-access";
import { readJsonObject, readString } from "@/lib/request-body";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  // preview/start와 같은 경계. 목소리 id를 받는 라우트는 예외 없이 소유권을 확인한다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  // 못 읽은 본문은 빈 본문과 같다 — 아래 두 검사가 그대로 받는다. 문자열이 아닌 값도
  // 없는 것으로 본다: `body.text?.trim()`과 `authorizeVoice`의 `voiceId?.trim()`이
  // JSON은 멀쩡한 요청에 500을 냈다.
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
    // 그대로 넘기면 `mapToneToTemperature`의 `.includes`와 속도 계산이 본문 타입에
    // 끌려간다. 500은 아니지만(fish 클라이언트가 삼킨다) 502와 NaN 속도가 된다.
    speakingSpeed: typeof body.speakingSpeed === "number" ? body.speakingSpeed : undefined,
    instruct: readString(body.instruct),
  });

  return NextResponse.json(result, { status: result.status === "error" ? 502 : 200 });
}
