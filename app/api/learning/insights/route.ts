import { NextResponse } from "next/server";
import { getLearningInsights, type LearnedFormat } from "@/lib/learning-store";

function toFormat(value: string | null): LearnedFormat {
  return value === "format_d" ? "format_d" : "format_a";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const insights = await getLearningInsights(toFormat(searchParams.get("format")));

  return NextResponse.json(insights);
}
