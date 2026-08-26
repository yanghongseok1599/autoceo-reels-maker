import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

export type LearnedFormat = "format_a" | "format_d";
export type LearnedStatus = "processing" | "completed" | "failed";
export type LearnedFeedback = "good" | "bad";

export type LearningRecord = {
  id: string;
  jobId: string;
  format: LearnedFormat;
  createdAt: string;
  updatedAt: string;
  status: LearnedStatus;
  script: string;
  duration?: string;
  quality?: string;
  platform?: string;
  tone?: string;
  speakingSpeed?: number;
  captionMode?: string;
  inputMode?: string;
  poseGuideName?: string;
  referenceCount: number;
  referenceNames: string[];
  resultUrl?: string;
  feedback?: LearnedFeedback;
};

export type LearningInput = {
  jobId: string;
  format: LearnedFormat;
  script?: string;
  duration?: string;
  quality?: string;
  platform?: string;
  tone?: string;
  speakingSpeed?: number;
  captionMode?: string;
  inputMode?: string;
  poseGuideName?: string;
  referenceNames?: string[];
};

export type LearningInsights = {
  total: number;
  completed: number;
  good: number;
  bad: number;
  bestPrompt: string;
  recommendation: string;
  signals: string[];
};

const dataDir = path.join(process.cwd(), ".local-data");
const dataFile = path.join(dataDir, "learning-records.json");

function createLearningId() {
  return `learn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function readRecords() {
  try {
    const raw = await readFile(dataFile, "utf8");
    return JSON.parse(raw) as LearningRecord[];
  } catch {
    return [];
  }
}

async function writeRecords(records: LearningRecord[]) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(records, null, 2), "utf8");
}

function uniqueCompact(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function createLearningRecord(input: LearningInput) {
  const now = new Date().toISOString();
  const records = await readRecords();
  const record: LearningRecord = {
    id: createLearningId(),
    jobId: input.jobId,
    format: input.format,
    createdAt: now,
    updatedAt: now,
    status: "processing",
    script: input.script?.trim() ?? "",
    duration: input.duration,
    quality: input.quality,
    platform: input.platform,
    tone: input.tone,
    speakingSpeed: input.speakingSpeed,
    captionMode: input.captionMode,
    inputMode: input.inputMode,
    poseGuideName: input.poseGuideName,
    referenceCount: input.referenceNames?.length ?? 0,
    referenceNames: uniqueCompact(input.referenceNames ?? []),
  };

  await writeRecords([record, ...records].slice(0, 300));
  return record;
}

export async function updateLearningRecord(
  id: string,
  patch: Partial<Pick<LearningRecord, "status" | "resultUrl" | "feedback">>,
) {
  const records = await readRecords();
  const nextRecords = records.map((record) =>
    record.id === id
      ? {
          ...record,
          ...patch,
          updatedAt: new Date().toISOString(),
        }
      : record,
  );
  await writeRecords(nextRecords);
  return nextRecords.find((record) => record.id === id) ?? null;
}

export async function findLearningRecordByJobId(jobId: string) {
  const records = await readRecords();
  return records.find((record) => record.jobId === jobId) ?? null;
}

export async function getLearningInsights(format: LearnedFormat): Promise<LearningInsights> {
  const records = (await readRecords()).filter((record) => record.format === format);
  const completed = records.filter((record) => record.status === "completed");
  const goodRecords = records.filter((record) => record.feedback === "good");
  const badRecords = records.filter((record) => record.feedback === "bad");
  const best = goodRecords[0] ?? completed[0] ?? records[0];
  const bestPrompt = best?.script ?? "";

  if (format === "format_d") {
    const goodReferenceCounts = goodRecords.map((record) => record.referenceCount).filter(Boolean);
    const averageReferences = goodReferenceCounts.length
      ? Math.round(goodReferenceCounts.reduce((sum, count) => sum + count, 0) / goodReferenceCounts.length)
      : 0;

    return {
      total: records.length,
      completed: completed.length,
      good: goodRecords.length,
      bad: badRecords.length,
      bestPrompt,
      recommendation: goodRecords.length
        ? `좋은 결과 기준으로 레퍼런스 ${averageReferences || 1}장 이상과 동작 가이드 1장을 먼저 넣는 조합을 추천합니다.`
        : "아직 평가된 결과가 없습니다. 좋은 결과를 누르면 동작별 추천 구도가 쌓입니다.",
      signals: [
        `저장된 운동 시연 ${records.length}건`,
        `좋은 결과 ${goodRecords.length}건`,
        averageReferences ? `평균 레퍼런스 ${averageReferences}장` : "레퍼런스 기준 수집 전",
      ],
    };
  }

  const bestTone = goodRecords.find((record) => record.tone)?.tone;

  return {
    total: records.length,
    completed: completed.length,
    good: goodRecords.length,
    bad: badRecords.length,
    bestPrompt,
    recommendation: goodRecords.length
      ? `${bestTone ? `좋은 결과에서 ${bestTone} 톤 반응이 좋았습니다. ` : ""}아바타 사진, 목소리 방식, 대본 길이를 이 조합에 맞춰 추천합니다.`
      : "아직 평가된 결과가 없습니다. 좋은 결과를 누르면 톤과 대본 패턴을 학습합니다.",
    signals: [
      `저장된 아바타 릴스 ${records.length}건`,
      `좋은 결과 ${goodRecords.length}건`,
      `아쉬운 결과 ${badRecords.length}건`,
    ],
  };
}
