export type HiggsfieldExercisePromptInput = {
  exercisePrompt: string;
  poseGuideName?: string;
  referenceNames: string[];
  duration: string;
  quality: string;
};

export type HiggsfieldAvatarPromptInput = {
  script: string;
  avatarFileName?: string;
  voiceFileName?: string;
  duration: string;
  quality: string;
  toneLabel: string;
  usesRecordedNarration: boolean;
};

export function buildHiggsfieldAvatarPrompt(input: HiggsfieldAvatarPromptInput) {
  const voiceInstruction = input.usesRecordedNarration
    ? `Use the uploaded full narration audio as the exact voice track: ${input.voiceFileName || "전체 녹음 파일"}.`
    : `Use the uploaded/generated voice audio as the voice reference: ${input.voiceFileName || "목소리 파일"}.`;

  return [
    "Create a vertical 9:16 talking avatar reel from the uploaded portrait photo.",
    `Avatar reference: ${input.avatarFileName || "얼굴 사진"}.`,
    voiceInstruction,
    `Tone: ${input.toneLabel}.`,
    `Target duration: ${input.duration}. Output quality: ${input.quality}.`,
    "The person should speak naturally to camera with realistic lip sync, subtle facial expression, and stable framing.",
    `Script: ${input.script.trim()}`,
    "Negative: no text overlay, no captions, no subtitles, no on-screen text, no watermark, no logo bugs, no lower-third, no graphic typography.",
  ].join("\n");
}

export function buildHiggsfieldExercisePrompt(input: HiggsfieldExercisePromptInput) {
  const references = input.referenceNames.length ? input.referenceNames.join(", ") : "트레이너 레퍼런스 이미지";
  const poseGuide = input.poseGuideName || "동작 가이드 이미지";

  return [
    input.exercisePrompt.trim(),
    "",
    `Reference assets: ${poseGuide}, ${references}.`,
    `Create a vertical 9:16 fitness demonstration video, ${input.duration}, ${input.quality}.`,
    "Use a realistic trainer in a clean studio or white background. Keep the full body visible enough to inspect posture.",
    "Motion must be anatomically correct, stable, and easy to follow. Prioritize exact joint alignment and controlled repetitions.",
    "Negative: no text overlay, no captions, no subtitles, no on-screen text, no watermark, no logo bugs, no lower-third, no graphic typography.",
  ].join("\n");
}

export const higgsfieldExerciseChecklist = [
  "Marketing Studio에서 9:16 세로 영상으로 생성",
  "단일 클립은 4~15초로 제한",
  "포즈 가이드와 트레이너 레퍼런스를 함께 첨부",
  "완성 MP4를 다시 업로드해서 좋은 결과/아쉬움으로 학습",
];

export const higgsfieldAvatarChecklist = [
  "얼굴 사진과 음성 파일을 힉스필드에 첨부",
  "대본 기반 립싱크 토킹 아바타로 생성",
  "화면 텍스트 없이 9:16 세로 릴스로 출력",
  "완성 MP4를 다시 업로드해서 톤/대본 패턴을 학습",
];
