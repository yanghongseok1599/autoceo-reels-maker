import { NextResponse } from "next/server";
import { getLearningInsights, type LearnedFormat } from "@/lib/learning-store";
import { readSessionFromRequest } from "@/lib/auth";

function toFormat(value: string | null): LearnedFormat {
  return value === "format_d" ? "format_d" : "format_a";
}

export async function GET(request: Request) {
  // 인사이트의 `bestPrompt`는 수강생이 직접 쓴 **대본 본문**이다. 세션 검사가 없던 동안
  // 로그인하지 않은 사람도 `?format=format_a` 한 번으로 남의 대본을 읽을 수 있었다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const insights = await getLearningInsights(ownerId, toFormat(searchParams.get("format")));

  return NextResponse.json(insights);
}
