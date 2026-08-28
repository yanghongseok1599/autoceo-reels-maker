import { NextResponse } from "next/server";
import {
  findLearningRecordByJobId,
  updateLearningRecord,
  type LearnedFeedback,
} from "@/lib/learning-store";
import { readSessionFromRequest } from "@/lib/auth";
import { readJsonObject } from "@/lib/request-body";

type FeedbackPayload = {
  learningRecordId?: string;
  jobId?: string;
  feedback?: LearnedFeedback;
};

export async function POST(request: Request) {
  // `learningRecordId`는 클라이언트가 보내는 값이다. 세션이 없으면 아무나 아무 id에
  // 평가를 남길 수 있고, 그 평가가 남의 인사이트를 움직인다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }

  // 못 읽은 본문은 **평가가 없는 본문과 똑같이** 다룬다. 형식이 틀린 것과 값이 빠진 것을
  // 갈라 알려 줄 이유가 없다 — 수강생에게는 어차피 같은 한 가지 할 일이다.
  const payload = ((await readJsonObject(request)) ?? {}) as FeedbackPayload;

  if (payload.feedback !== "good" && payload.feedback !== "bad") {
    return NextResponse.json({ error: "평가 값이 필요합니다." }, { status: 400 });
  }

  const targetId =
    payload.learningRecordId ||
    (payload.jobId ? (await findLearningRecordByJobId(ownerId, payload.jobId))?.id : "");

  if (!targetId) {
    return NextResponse.json({ error: "학습 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  const record = await updateLearningRecord(ownerId, targetId, { feedback: payload.feedback });

  // 남의 기록 id를 적어 보낸 경우도 여기로 온다. "없음"과 "남의 것"을 구별해 알려 줄 이유가 없다.
  if (!record) {
    return NextResponse.json({ error: "학습 기록을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({ record });
}
