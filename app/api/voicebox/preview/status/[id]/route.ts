import { NextResponse } from "next/server";
import { getFishSpeechStatus } from "@/lib/fish-audio-client";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getFishSpeechStatus(id);
  return NextResponse.json(result);
}
