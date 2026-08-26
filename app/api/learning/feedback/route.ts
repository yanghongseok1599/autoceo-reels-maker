import { NextResponse } from "next/server";
import {
  findLearningRecordByJobId,
  updateLearningRecord,
  type LearnedFeedback,
} from "@/lib/learning-store";

type FeedbackPayload = {
  learningRecordId?: string;
  jobId?: string;
  feedback?: LearnedFeedback;
};

export async function POST(request: Request) {
  const payload = (await request.json()) as FeedbackPayload;

  if (payload.feedback !== "good" && payload.feedback !== "bad") {
    return NextResponse.json({ error: "평가 값이 필요합니다." }, { status: 400 });
  }

  const targetId = payload.learningRecordId || (payload.jobId ? (await findLearningRecordByJobId(payload.jobId))?.id : "");

  if (!targetId) {
    return NextResponse.json({ error: "학습 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  const record = await updateLearningRecord(targetId, { feedback: payload.feedback });

  return NextResponse.json({ record });
}
