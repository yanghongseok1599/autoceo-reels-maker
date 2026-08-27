import { store } from "./store";

export type LearnedFormat = "format_a" | "format_d";
export type LearnedStatus = "processing" | "completed" | "failed";
export type LearnedFeedback = "good" | "bad";

/**
 * 학습 기록에는 수강생이 **직접 쓴 대본 본문**이 들어 있고, 인사이트의 `bestPrompt`가 그것을
 * 그대로 내보낸다. 그러니 `ownerId`는 편의 필드가 아니라 경계다 — 목소리
 * (`lib/fish-voice-store.ts`)·클립아트(`lib/clipart-store.ts`)와 같은 경계이고 같은 모양으로 지킨다.
 */
export type LearningRecord = {
  id: string;
  ownerId: string;
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
 */

/**
 * 소유자당 키 하나. 예전에는 모든 수강생의 기록이 `learning-records` 배열 하나에 있었고,
 * 그게 두 가지를 한꺼번에 고장 냈다.
 *
 * 하나는 누출이다. `getLearningInsights`가 그 배열 전체에서 `best`를 골라 `bestPrompt`로
 * 대본 본문을 돌려줬으니, 아무나 자기 인사이트를 열어 남의 대본을 읽었다.
 * 다른 하나는 덮어쓰기다. 저장이 배열 전체를 읽고 고쳐 다시 쓰는 일이라, 두 수강생이 같은
 * 순간에 저장하면 나중에 쓴 쪽이 앞선 쪽의 기록을 통째로 지웠다.
 *
 * 키를 나누면 겹칠 자리 자체가 없고, 남의 기록은 애초에 읽히지 않는다. 300건 상한도
 * 전체가 아니라 사람마다로 바뀐다 — 예전에는 활발한 수강생 한 명이 다른 사람들의 기록을
 * 상한 밖으로 밀어냈다.
 */
const keyFor = (ownerId: string) => `learning-records/${ownerId}`;

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

/**
 * 그 소유자의 키에 들어 있는 것 전부. 소유자가 빈 값이면 전부가 아니라 아무것도 아니다 —
 * `learning-records/`라는 아무의 것도 아닌 자리를 읽어 그걸 누군가의 기록처럼 다루면 안 된다.
 *
 * 쓰기 경로는 이 함수를 쓴다. 아래 `readOwned`의 필터를 통과한 목록을 그대로 다시 쓰면,
 * 어쩌다 이 키에 섞여 든 남의 기록을 조용히 **지우게** 된다. 경계는 안 보이게 하는 것이지
 * 지우는 것이 아니다.
 */
async function readRecords(ownerId: string): Promise<LearningRecord[]> {
  if (!ownerId) return [];
  const records = await store.read<LearningRecord[]>(keyFor(ownerId), []);
  return Array.isArray(records) ? records : [];
}

/**
 * 읽기 경로가 쓰는 목록. 키가 이미 소유자를 나누지만 선가드와 `ownerId` 필터를 둘 다 남긴다.
 * 방어가 한 겹뿐이면 나중에 키 구조를 바꿀 때 경계가 조용히 열린다 — 그리고 여기서 열리는
 * 경계는 남의 대본 본문이다.
 */
async function readOwned(ownerId: string): Promise<LearningRecord[]> {
  return (await readRecords(ownerId)).filter((record) => record.ownerId === ownerId);
}

async function writeRecords(ownerId: string, records: LearningRecord[]) {
  await store.write(keyFor(ownerId), records);
}

function uniqueCompact(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

export async function createLearningRecord(input: LearningInput & { ownerId: string }) {
  const now = new Date().toISOString();
  const records = await readRecords(input.ownerId);
  const record: LearningRecord = {
    id: createLearningId(),
    ownerId: input.ownerId,
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

  await writeRecords(input.ownerId, [record, ...records].slice(0, 300));
  return record;
}

/**
 * `ownerId`가 첫 인자인 것은 서명을 다듬은 결과가 아니다. id는 클라이언트가 보내는 값이라
 * 그것만으로 고르면 남의 기록에 평가를 남길 수 있다. 소유자가 함께 있어야 고를 수 있다.
 *
 * 대상이 없으면 아무것도 쓰지 않고 `null`을 돌려준다. 부르는 쪽은 그걸 404로 옮긴다 —
 * "없음"과 "남의 것"을 구별해서 알려 줄 이유가 없다.
 */
export async function updateLearningRecord(
  ownerId: string,
  id: string,
  patch: Partial<Pick<LearningRecord, "status" | "resultUrl" | "feedback">>,
) {
  // 빈 소유자 선가드는 `readRecords` 한 곳에만 둔다. 같은 검사를 여기 한 번 더 적으면
  // 지워도 아무 검사가 실패하지 않는 방어가 되고, 그런 방어는 언젠가 지워진다.
  const records = await readRecords(ownerId);
  const index = records.findIndex((record) => record.id === id && record.ownerId === ownerId);
  if (index < 0) return null;

  const updated: LearningRecord = {
    ...records[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  await writeRecords(ownerId, records.map((record, i) => (i === index ? updated : record)));
  return updated;
}

export async function findLearningRecordByJobId(ownerId: string, jobId: string) {
  return (await readOwned(ownerId)).find((record) => record.jobId === jobId) ?? null;
}

/**
 * 세는 대상이 그 수강생의 기록으로 좁혀진다. 문턱(`RECOMMENDATION_MIN_SAMPLES`)과 두 분기는
 * 그대로다 — 바뀐 것은 **누구의 평가를 세는가**뿐이다.
 */
export async function getLearningInsights(
  ownerId: string,
  format: LearnedFormat,
): Promise<LearningInsights> {
  const records = (await readOwned(ownerId)).filter((record) => record.format === format);
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
