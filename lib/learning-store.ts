import { store } from "./store";

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

/**
 * 예전에는 이 모듈이 `.local-data/learning-records.json`을 직접 readFile/writeFile 했다.
 * Vercel의 파일시스템은 읽기 전용이라 배포하면 기록이 조용히 사라지고 인사이트는 늘
 * 비어 있었다 — `fish-voices`가 겪었던 것과 같은 고장이다. 저장소 선택은 `lib/store`에 맡긴다.
 * 키를 `learning-records`로 두면 파일 구현이 쓰는 경로가 예전과 같아 로컬 기록이 그대로 이어진다.
 */
const KEY = "learning-records";

/**
 * 처방을 내보내기 전에 필요한 최소 **평가** 건수.
 *
 * 10은 "이만큼이면 믿을 만하다"는 수가 아니다. 스펙 §12를 보면 같은 브랜드의 다른
 * 파이프라인이 표면 특징 10개를 n=248로 봤을 때 9개가 성과를 구분하지 못했고, 서사 유형
 * 7개를 n=44로 봤을 때 신뢰구간이 전부 겹쳤다. 수백 건으로도 답이 안 나온 종류의 질문이므로
 * 10건이 통계적 충분표본일 리 없다 — 그 아래에서는 주장이 명백히 근거 없다는 **바닥**일 뿐이다.
 * 문턱을 넘은 뒤의 추천도 생성 품질(얼굴 안정성·립싱크·구도) 관찰에 한정하며 콘텐츠 성과를
 * 약속하지 않는다.
 */
export const RECOMMENDATION_MIN_SAMPLES = 10;

/**
 * 문턱 아래에서 처방 대신 내보내는 문구. 수강생이 돈을 내고 보는 자리이므로 오류나 꾸중이
 * 아니라 "아직은 아니고, 무엇이 쌓이면 시작한다"로 읽혀야 한다.
 */
const INSUFFICIENT = `아직 판단할 표본이 부족합니다. 평가가 ${RECOMMENDATION_MIN_SAMPLES}건 모이고 그중 좋은 결과가 있으면 추천을 시작합니다.`;

function createLearningId() {
  return `learn_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

async function readRecords(): Promise<LearningRecord[]> {
  const records = await store.read<LearningRecord[]>(KEY, []);
  return Array.isArray(records) ? records : [];
}

async function writeRecords(records: LearningRecord[]) {
  await store.write(KEY, records);
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

  /**
   * 저장 건수가 아니라 **평가된** 건수를 센다. 평가 없이 쌓이기만 한 릴스 10건은
   * 근거가 0건이다. 아래 두 분기가 각자 recommendation을 반환하므로 문턱도 양쪽에 건다 —
   * 한쪽만 걸면 D탭이 n=1로 계속 처방한다.
   */
  const ratedCount = goodRecords.length + badRecords.length;

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
      recommendation:
        ratedCount < RECOMMENDATION_MIN_SAMPLES
          ? INSUFFICIENT
          : goodRecords.length
            ? `좋은 결과 기준으로 레퍼런스 ${averageReferences || 1}장 이상과 동작 가이드 1장을 먼저 넣는 조합을 추천합니다.`
            : "좋은 결과로 평가된 기록이 아직 없어 추천할 조합을 고르지 못했습니다.",
      // signals는 문턱과 무관하다. 관측한 사실을 그대로 적는 일은 표본 수와 상관없이 정직하다.
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
    recommendation:
      ratedCount < RECOMMENDATION_MIN_SAMPLES
        ? INSUFFICIENT
        : goodRecords.length
          ? `${bestTone ? `좋은 결과에서 ${bestTone} 톤 반응이 좋았습니다. ` : ""}아바타 사진, 목소리 방식, 대본 길이를 이 조합에 맞춰 추천합니다.`
          : "좋은 결과로 평가된 기록이 아직 없어 추천할 조합을 고르지 못했습니다.",
    // signals는 문턱과 무관하다. 관측한 사실을 그대로 적는 일은 표본 수와 상관없이 정직하다.
    signals: [
      `저장된 아바타 릴스 ${records.length}건`,
      `좋은 결과 ${goodRecords.length}건`,
      `아쉬운 결과 ${badRecords.length}건`,
    ],
  };
}
