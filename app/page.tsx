"use client";

import { ChangeEvent, useEffect, useState } from "react";
import {
  buildHiggsfieldAvatarPrompt,
  buildHiggsfieldExercisePrompt,
  higgsfieldAvatarChecklist,
  higgsfieldExerciseChecklist,
} from "@/lib/higgsfield-workflow";

type JobStatus = "idle" | "uploading" | "processing" | "completed" | "failed";
type ContentFormat = "A" | "D";
type DurationOption = "8s" | "12s" | "15s";
type ToneOption = "friendly" | "expert" | "energetic" | "calm";
type QualityOption = "1080p" | "2k" | "4k";
type CaptionOption = "auto" | "off";
type VoiceboxStatus = "checking" | "connected" | "offline";
type VoiceInputMode = "clone" | "recording";

type VoiceProfileSummary = {
  id: string;
  name: string;
  voiceType?: string;
  sampleCount?: number;
};

/** `GET /api/clipart`가 돌려주는 한 항목(`lib/clipart.ts`의 `ClipartEntry`). */
type ClipartEntrySummary = {
  id: string;
  keyword: string;
  aliases: string[];
  category: string;
  source: "preset" | "student";
  file: string;
};

type ClipartUploadStatus = "idle" | "uploading" | "done";

/**
 * 프리셋 목록에서 낱말 칩으로 보여 줄 개수. 실측 카탈로그가 114개라 전부 늘어놓으면
 * 패널이 칩으로만 채워지고 정작 읽어야 할 안내가 밀려난다. 나머지는 개수로만 적는다.
 */
const PRESET_KEYWORD_PREVIEW_COUNT = 8;

type LearningInsights = {
  total: number;
  completed: number;
  good: number;
  bad: number;
  bestPrompt: string;
  recommendation: string;
  signals: string[];
};

type UploadState = {
  fileName: string;
  id: string;
  previewUrl: string;
  status: JobStatus;
  error: string;
};

const starterScript =
  "오늘은 스쿼트할 때 무릎이 안쪽으로 모이는 문제를 잡는 간단한 팁을 알려드릴게요. 발바닥을 바닥에 고르게 누르고, 내려갈 때 무릎이 두 번째 발가락 방향을 따라가게 해보세요.";

const formatDScript =
  "덤벨컬 동작 가이드 시트와 남성 피트니스 모델 레퍼런스를 참고해서, 흰 배경에서 덤벨컬을 정확한 자세로 시연하는 15초 운동 영상을 만들어줘.";

const starterVoiceReference =
  "안녕하세요. 오늘은 필라테스 수업에서 자주 쓰는 호흡과 자세 팁을 안내해드리겠습니다.";

const TONE_INSTRUCT: Record<ToneOption, string> = {
  friendly: "친근하고 다정하게, 편안하고 부드러운 말투로 말해줘",
  expert: "차분하고 전문가답게, 신뢰감 있는 말투로 또박또박 말해줘",
  energetic: "밝고 활기차게, 에너지 넘치고 경쾌한 말투로 말해줘",
  calm: "차분하고 편안하게, 천천히 안정된 말투로 말해줘",
};

function emptyUpload(): UploadState {
  return {
    fileName: "",
    id: "",
    previewUrl: "",
    status: "idle",
    error: "",
  };
}

/** 파일명에서 확장자를 뗀 부분. 키워드 기본값의 재료다. */
function fileStem(name: string) {
  return name.replace(/\.[^.]+$/, "").trim();
}

/**
 * 수강생이 올린 캐릭터 그림의 브라우저 주소.
 *
 * `ArtifactStore.publish`의 반환값이 두 모양이다: 로컬은 `clipart/ab12.png`(앞 슬래시 없는
 * public 루트 상대 경로), 배포(Blob)는 `https://...` 절대 URL. 상대 경로를 그대로 `src`에 넣으면
 * 지금 보고 있는 경로 기준으로 풀려 404가 난다.
 *
 * **프리셋 항목에는 쓰지 않는다.** 프리셋의 `file`은 운영자 Codex 스킬 디렉터리 기준
 * (`assets/clipart/걱정.png`)이고 그 디렉터리는 `public/` 밖이라 브라우저에서 열 방법이 아예 없다
 * (`lib/clipart-preset.ts`의 `presetDir` 주석).
 */
function studentClipartSrc(file: string) {
  return /^https?:\/\//.test(file) ? file : `/${file.replace(/^\/+/, "")}`;
}

function estimateTalkSeconds(script: string, speed: number) {
  const textLength = script.replace(/\s/g, "").length;
  const charsPerSecond = 4.4 + speed * 0.9;
  return Math.max(5, Math.ceil(textLength / charsPerSecond));
}

function statusLabel(status: JobStatus) {
  return {
    idle: "대기 중",
    uploading: "업로드 중",
    processing: "생성 중",
    completed: "완료",
    failed: "실패",
  }[status];
}

function progressStageLabel(value: number, status: JobStatus) {
  if (status === "completed") return "완성";
  if (value < 25) return "음성 합성 중";
  if (value < 55) return "아바타 렌더링 중";
  if (value < 85) return "자막·타이밍 합성 중";
  return "마무리 중";
}

function previewStageLabel(status: string) {
  const value = (status || "").toLowerCase();
  if (value === "loading_model") return "모델 로딩 중";
  if (value === "generating" || value === "queued" || value === "pending") return "음성 합성 중";
  if (value === "completed" || value === "done" || value === "ready") return "완료";
  return "준비 중";
}

export default function Home() {
  const [selectedFormat, setSelectedFormat] = useState<ContentFormat>("A");
  const [avatar, setAvatar] = useState<UploadState>(emptyUpload);
  const [voice, setVoice] = useState<UploadState>(emptyUpload);
  const [scriptByFormat, setScriptByFormat] = useState<Record<ContentFormat, string>>({
    A: starterScript,
    D: formatDScript,
  });
  const [narrationAudioName, setNarrationAudioName] = useState("");
  const [poseGuideName, setPoseGuideName] = useState("");
  const [referenceNames, setReferenceNames] = useState<string[]>([]);
  const [higgsfieldResultName, setHiggsfieldResultName] = useState("");
  const [higgsfieldPreviewUrl, setHiggsfieldPreviewUrl] = useState("");
  const [avatarImagePrompt, setAvatarImagePrompt] = useState("남성 피트니스 모델, 검정 운동복, 정면/측면/후면 레퍼런스");
  const [poseGuidePrompt, setPoseGuidePrompt] = useState("덤벨컬 준비 자세, 수축 자세, 팔꿈치 고정 주의사항이 보이는 동작 가이드 시트");
  const [jobId, setJobId] = useState("");
  const [videoStatus, setVideoStatus] = useState<JobStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [displayProgress, setDisplayProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState("");
  const [resultAudioUrl, setResultAudioUrl] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [duration, setDuration] = useState<DurationOption>("12s");
  const [speakingSpeed, setSpeakingSpeed] = useState(2);
  const [tone, setTone] = useState<ToneOption>("expert");
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [previewAudioUrl, setPreviewAudioUrl] = useState("");
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewDisplayProgress, setPreviewDisplayProgress] = useState(0);
  const [previewStatusValue, setPreviewStatusValue] = useState("");
  const [captionMode, setCaptionMode] = useState<CaptionOption>("auto");
  const [quality, setQuality] = useState<QualityOption>("1080p");
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfileSummary[]>([]);
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState("");
  const [voiceReferenceText, setVoiceReferenceText] = useState(starterVoiceReference);
  const [voiceboxStatus, setVoiceboxStatus] = useState<VoiceboxStatus>("checking");
  const [voiceInputMode, setVoiceInputMode] = useState<VoiceInputMode>("clone");
  const [clipartEntries, setClipartEntries] = useState<ClipartEntrySummary[]>([]);
  /**
   * 지금 릴스에 들어가는 캐릭터가 **내 것이 아닌지**. 서버가 답을 준 경우에만 참이 된다.
   *
   * 조회에 실패했을 때 참으로 두지 않는 이유: 캐릭터를 이미 올린 수강생에게 "남의 캐릭터가
   * 나갑니다"라고 말하는 것도 틀린 말이고, 한 번 틀린 안내는 다음에 진짜로 떴을 때도 무시된다.
   * 모르면 아무 말도 하지 않는다.
   */
  const [usingPresetCharacter, setUsingPresetCharacter] = useState(false);
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [characterFileName, setCharacterFileName] = useState("");
  const [characterKeyword, setCharacterKeyword] = useState("");
  const [characterAliases, setCharacterAliases] = useState("");
  const [characterCategory, setCharacterCategory] = useState("");
  const [characterUploadStatus, setCharacterUploadStatus] = useState<ClipartUploadStatus>("idle");
  const [characterDoneMessage, setCharacterDoneMessage] = useState("");
  const [characterError, setCharacterError] = useState("");
  const [learningRecordId, setLearningRecordId] = useState("");
  const [learningInsights, setLearningInsights] = useState<LearningInsights | null>(null);
  const [learningFeedback, setLearningFeedback] = useState<"good" | "bad" | "">("");
  const [message, setMessage] = useState("");
  const script = scriptByFormat[selectedFormat];
  const isExerciseMode = selectedFormat === "D";
  const activeVoiceId = selectedVoiceProfileId || voice.id;
  const usesRecordedNarration = selectedFormat === "A" && voiceInputMode === "recording" && Boolean(narrationAudioName);
  const hasVoiceInput = voiceInputMode === "recording" ? Boolean(narrationAudioName) : Boolean(activeVoiceId);
  const selectedVoiceProfile = voiceProfiles.find((profile) => profile.id === activeVoiceId);
  const hasPrompt = Boolean(script.trim());
  const avatarReady = Boolean(avatar.id);
  const voiceReady = hasVoiceInput;
  const activeStepCard =
    videoStatus === "processing" || videoStatus === "completed"
      ? 2
      : !avatarReady || !voiceReady
        ? 0
        : 1;
  const roundedProgress = Math.round(displayProgress);
  const stageLabel = progressStageLabel(displayProgress, videoStatus);
  const readyItems = isExerciseMode
    ? [
        { label: "동작 가이드", done: Boolean(poseGuideName) },
        { label: "트레이너 레퍼런스", done: referenceNames.length > 0 },
        { label: "힉스필드 결과", done: Boolean(higgsfieldResultName) },
      ]
    : [
        { label: "아바타 사진", done: Boolean(avatar.id) },
        { label: voiceInputMode === "recording" ? "전체 녹음" : "목소리", done: hasVoiceInput },
        { label: "대본", done: hasPrompt },
      ];
  // `catalogFor`는 둘을 섞지 않는다 — 내 것이 하나라도 있으면 프리셋은 아예 빠진다.
  // 그래서 `usingPresetCharacter`가 목록 전체의 성격을 가른다.
  const myCharacters = usingPresetCharacter ? [] : clipartEntries;
  const presetKeywords = usingPresetCharacter ? clipartEntries.map((entry) => entry.keyword) : [];
  const hiddenPresetCount = Math.max(0, presetKeywords.length - PRESET_KEYWORD_PREVIEW_COUNT);
  const estimatedTalkSeconds = estimateTalkSeconds(script, speakingSpeed);
  const outputSizeLabel = {
    "1080p": "MP4 1080x1920",
    "2k": "MP4 1440x2560",
    "4k": "MP4 2160x3840",
  }[quality];
  const higgsfieldPrompt = buildHiggsfieldExercisePrompt({
    exercisePrompt: script,
    poseGuideName,
    referenceNames,
    duration,
    quality,
  });
  const avatarHiggsfieldPrompt = buildHiggsfieldAvatarPrompt({
    script,
    avatarFileName: avatar.fileName,
    voiceFileName: narrationAudioName || resultAudioUrl || voice.fileName || selectedVoiceProfile?.name,
    duration: `${estimatedTalkSeconds}s`,
    quality,
    toneLabel: TONE_INSTRUCT[tone],
    usesRecordedNarration,
  });
  const activeHiggsfieldPrompt = isExerciseMode ? higgsfieldPrompt : avatarHiggsfieldPrompt;
  const activeHiggsfieldChecklist = isExerciseMode ? higgsfieldExerciseChecklist : higgsfieldAvatarChecklist;

  useEffect(() => {
    return () => {
      if (avatar.previewUrl) {
        URL.revokeObjectURL(avatar.previewUrl);
      }
    };
  }, [avatar.previewUrl]);

  useEffect(() => {
    return () => {
      if (higgsfieldPreviewUrl) {
        URL.revokeObjectURL(higgsfieldPreviewUrl);
      }
    };
  }, [higgsfieldPreviewUrl]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDisplayProgress((current) => {
        const diff = progress - current;
        if (Math.abs(diff) < 0.4) return progress;
        return current + diff * 0.18;
      });
    }, 70);
    return () => window.clearInterval(timer);
  }, [progress]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPreviewDisplayProgress((current) => {
        const diff = previewProgress - current;
        if (Math.abs(diff) < 0.4) return previewProgress;
        return current + diff * 0.18;
      });
    }, 70);
    return () => window.clearInterval(timer);
  }, [previewProgress]);

  useEffect(() => {
    async function loadVoiceboxProfiles() {
      try {
        const response = await fetch("/api/voicebox/profiles", { cache: "no-store" });
        const data = await response.json();

        if (!response.ok || !data.health?.reachable) {
          setVoiceboxStatus("offline");
          return;
        }

        const profiles = (data.profiles ?? []) as VoiceProfileSummary[];
        setVoiceboxStatus("connected");
        setVoiceProfiles(profiles);
        setSelectedVoiceProfileId((current) => current || profiles[0]?.id || "");
      } catch {
        setVoiceboxStatus("offline");
      }
    }

    loadVoiceboxProfiles();
  }, []);

  useEffect(() => {
    loadClipartCatalog();
  }, []);

  useEffect(() => {
    loadLearningInsights(selectedFormat);
  }, [selectedFormat]);

  /**
   * 이 수강생의 릴스에 실제로 쓰일 캐릭터 목록을 읽는다.
   *
   * `usingPreset`은 서버가 정한다(`lib/clipart-store.ts`의 `catalogFor`). 여기서 다시 계산하지
   * 않는 이유는 규칙이 두 곳에 생기면 화면의 안내와 실제 렌더가 조용히 어긋나기 때문이다 —
   * 안내가 틀리는 순간 이 기능은 없느니만 못해진다.
   */
  async function loadClipartCatalog() {
    try {
      const response = await fetch("/api/clipart", { cache: "no-store" });
      const data = await response.json();

      // 401(로그인 전)을 포함해 답을 못 받은 경우다. 모르는 것을 아는 척하지 않는다.
      if (!response.ok) return;

      setClipartEntries(Array.isArray(data.entries) ? (data.entries as ClipartEntrySummary[]) : []);
      setUsingPresetCharacter(Boolean(data.usingPreset));
    } catch {
      // 같은 이유로 아무것도 바꾸지 않는다.
    }
  }

  async function loadLearningInsights(format: ContentFormat) {
    try {
      const response = await fetch(`/api/learning/insights?format=${format === "D" ? "format_d" : "format_a"}`, {
        cache: "no-store",
      });
      const data = await response.json();

      if (response.ok) {
        setLearningInsights(data);
      }
    } catch {
      setLearningInsights(null);
    }
  }

  function selectFormat(format: ContentFormat) {
    setSelectedFormat(format);
    setMessage("");
    setLearningFeedback("");
  }

  function updateScript(value: string) {
    setScriptByFormat((current) => ({
      ...current,
      [selectedFormat]: value,
    }));
  }

  function createAvatar(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setAvatar({ ...emptyUpload(), fileName: file.name, error: "JPG 또는 PNG 파일만 업로드할 수 있습니다." });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      setAvatar({ ...emptyUpload(), fileName: file.name, error: "사진은 최대 10MB까지 업로드할 수 있습니다." });
      return;
    }

    // Remotion 렌더 경로는 아바타 사진이 필요 없다. 백엔드 생성 호출 없이 로컬 미리보기만
    // 유지한다 — 캐릭터 에셋 업로드/저장은 계획 2에서 다시 연결한다.
    const previewUrl = URL.createObjectURL(file);
    setAvatar({ fileName: file.name, id: `local_${crypto.randomUUID()}`, previewUrl, status: "completed", error: "" });
  }

  async function createVoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["audio/wav", "audio/mpeg", "audio/mp3"].includes(file.type)) {
      setVoice({ ...emptyUpload(), fileName: file.name, error: "WAV 또는 MP3 파일만 업로드할 수 있습니다." });
      return;
    }

    setVoiceInputMode("clone");

    if (!voiceReferenceText.trim()) {
      setVoice({ ...emptyUpload(), fileName: file.name, error: "샘플 음성에 실제로 말한 대본을 먼저 입력해주세요." });
      return;
    }

    setVoice({ fileName: file.name, id: "", previewUrl: "", status: "uploading", error: "" });
    const formData = new FormData();
    formData.append("sample", file);
    formData.append("name", `내 목소리 ${new Date().toLocaleDateString("ko-KR")}`);
    formData.append("language", "ko");
    formData.append("referenceText", voiceReferenceText.trim());

    try {
      const response = await fetch("/api/voicebox/clone", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Voicebox 목소리 등록에 실패했습니다.");
      }

      setVoice({ fileName: file.name, id: data.id, previewUrl: "", status: "completed", error: "" });
      setSelectedVoiceProfileId(data.id);
      setVoiceProfiles((current) => [data, ...current.filter((profile) => profile.id !== data.id)]);
      setVoiceboxStatus("connected");
    } catch (error) {
      setVoice({
        fileName: file.name,
        id: "",
        previewUrl: "",
        status: "failed",
        error: error instanceof Error ? error.message : "Voicebox 목소리 등록에 실패했습니다.",
      });
      setVoiceboxStatus("offline");
    }
  }

  /**
   * 올릴 그림을 고른다. 아직 보내지는 않는다 — 키워드를 먼저 확인시켜야 하기 때문이다.
   *
   * 키워드가 곧 이 캐릭터가 불려 나올 조건이라, 파일명 그대로 저장되면 `character-final-2` 같은
   * 값이 키워드가 되어 어떤 대본에도 걸리지 않는 항목이 만들어진다. 목록에는 보이는데 영상에는
   * 영영 안 나오는 상태라 수강생이 원인을 알 수 없다.
   */
  function selectCharacterFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    // 기본값은 파일명이되, 수강생이 직접 고친 키워드는 덮지 않는다. 그림만 다시 고르는
    // 경우(잘못된 파일을 골랐을 때)에 애써 적은 낱말이 사라지면 안 된다.
    const previousDefault = fileStem(characterFileName);
    setCharacterKeyword((current) => (current && current !== previousDefault ? current : fileStem(file.name)));
    setCharacterFile(file);
    setCharacterFileName(file.name);
    setCharacterUploadStatus("idle");
    setCharacterDoneMessage("");
    setCharacterError("");
  }

  async function uploadClipart() {
    if (!characterFile) {
      setCharacterError("올릴 캐릭터 PNG 파일을 먼저 선택해주세요.");
      return;
    }

    if (!characterKeyword.trim()) {
      setCharacterError("대본에서 이 캐릭터를 부를 키워드를 입력해주세요.");
      return;
    }

    setCharacterUploadStatus("uploading");
    setCharacterDoneMessage("");
    setCharacterError("");

    const formData = new FormData();
    formData.append("image", characterFile);
    formData.append("keyword", characterKeyword.trim());
    formData.append("aliases", characterAliases);
    formData.append("category", characterCategory.trim());

    try {
      const response = await fetch("/api/clipart", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        /**
         * 라우트의 거절 문구를 **그대로** 올린다. 이 라우트는 거절 이유마다 다른 한국어 문장을
         * 돌려준다(PNG가 아님 / 투명 배경이 없음 / 키워드 없음 / 너무 큼). "업로드 실패"로
         * 뭉개면 수강생은 그림을 다시 내보내야 하는지 이름을 고쳐야 하는지 알 수 없고,
         * 알 수 없으면 같은 파일을 다시 올린다.
         */
        throw new Error(data.error ?? "캐릭터 업로드에 실패했습니다.");
      }

      // 내 것이 하나라도 생기면 프리셋은 더 이상 쓰이지 않는다(`catalogFor`). 방금 저장에
      // 성공했으므로 그 사실은 여기서 이미 확정이고, 이어지는 재조회가 실패해도 안내는 내려간다.
      const entry = data.entry as ClipartEntrySummary;
      const replaced = myCharacters.some((existing) => existing.keyword === entry.keyword);

      // 목록도 `addStudentClipart`와 같은 규칙으로 맞춘다: 같은 키워드는 갈아 끼우고, 새 키워드는
      // 뒤에 붙인다. 통째로 `[entry]`로 갈면 캐릭터가 여럿인 수강생의 목록이 잠깐 하나로 줄고,
      // 뒤따르는 재조회가 실패하면 그 잘못된 목록이 그대로 남는다. 진실은 여전히 서버에 있고
      // 바로 아래에서 다시 읽는다 — 여기 계산은 그 사이를 메우는 값일 뿐이다.
      setClipartEntries(() => {
        const mine = usingPresetCharacter ? [] : clipartEntries;
        const at = mine.findIndex((existing) => existing.keyword === entry.keyword);
        return at >= 0 ? mine.map((existing, i) => (i === at ? entry : existing)) : [...mine, entry];
      });
      setUsingPresetCharacter(false);
      setCharacterDoneMessage(
        replaced
          // 갈아 끼웠다는 걸 말해 준다. 이 화면이 없으면 수강생은 같은 키워드를 다시 올린 뒤
          // 목록 길이가 그대로인 것을 보고 "안 올라갔나?" 하고 또 올린다.
          // 그림만이 아니라 항목 전체가 바뀐다는 것도 같이 말한다. 이 폼이 곧 저장되는 내용이라,
          // 비슷한 말을 비워 둔 채 다시 올리면 전에 적어 둔 별칭이 함께 사라진다.
          ? `"${entry.keyword}" 캐릭터를 방금 올린 그림으로 바꿨습니다. 비슷한 말·분류도 지금 적은 값으로 덮어씁니다.`
          : "캐릭터를 저장했습니다. 이제부터 내 캐릭터가 들어갑니다.",
      );
      setCharacterUploadStatus("done");
      setCharacterFile(null);
      setCharacterFileName("");
      setCharacterKeyword("");
      setCharacterAliases("");
      setCharacterCategory("");
      await loadClipartCatalog();
    } catch (error) {
      setCharacterUploadStatus("idle");
      setCharacterError(error instanceof Error ? error.message : "캐릭터 업로드에 실패했습니다.");
    }
  }

  function handleNarrationUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["audio/wav", "audio/mpeg", "audio/mp3"].includes(file.type)) {
      setMessage("전체 녹음 파일은 WAV 또는 MP3만 업로드할 수 있습니다.");
      return;
    }

    setVoiceInputMode("recording");
    setNarrationAudioName(file.name);
    setMessage("");
  }

  function handlePoseGuideUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setMessage("포즈 가이드는 JPG 또는 PNG 파일만 업로드할 수 있습니다.");
      return;
    }
    setMessage("");
    setPoseGuideName(file.name);
  }

  function handleReferenceUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    const invalid = files.find((file) => !["image/jpeg", "image/png"].includes(file.type));
    if (invalid) {
      setMessage("레퍼런스 이미지는 JPG 또는 PNG 파일만 업로드할 수 있습니다.");
      return;
    }
    setMessage("");
    setReferenceNames(files.slice(0, 9).map((file) => file.name));
  }

  async function copyHiggsfieldPrompt() {
    if (selectedFormat === "D" && (!poseGuideName || !referenceNames.length)) {
      setMessage("포즈 가이드와 트레이너 레퍼런스를 먼저 준비해주세요.");
      return;
    }

    if (selectedFormat === "A" && (!avatar.id || !hasVoiceInput)) {
      setMessage("아바타 사진과 목소리 파일을 먼저 준비해주세요.");
      return;
    }

    await navigator.clipboard.writeText(activeHiggsfieldPrompt);
    setMessage("힉스필드용 프롬프트를 복사했습니다. 힉스필드에서 붙여넣고 생성하세요.");
  }

  function openHiggsfield() {
    window.open("https://higgsfield.ai/", "_blank", "noopener,noreferrer");
  }

  async function importHiggsfieldResult(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== "video/mp4") {
      setMessage("힉스필드 결과물은 MP4 파일로 업로드해주세요.");
      return;
    }

    // 이 파일은 서버 어디에도 업로드되지 않는다 — 학습 기록은 파일 이름만 남긴다.
    // 브라우저가 들고 있는 이 File이 유일한 실제 결과물이므로, 미리보기는
    // 여기서 만든 오브젝트 URL로 직접 보여준다(스톡 사진 대체 금지).
    const previewUrl = URL.createObjectURL(file);
    setHiggsfieldPreviewUrl(previewUrl);

    const response = await fetch("/api/learning/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format: selectedFormat === "D" ? "format_d" : "format_a",
        script,
        duration,
        quality,
        platform,
        captionMode,
        poseGuideName,
        referenceNames,
        resultFileName: file.name,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "힉스필드 결과 업로드 기록에 실패했습니다.");
      return;
    }

    setJobId(data.jobId);
    setLearningRecordId(data.record?.id ?? "");
    setResultUrl(data.record?.resultUrl ?? file.name);
    setHiggsfieldResultName(file.name);
    setVideoStatus("completed");
    setProgress(100);
    setLearningFeedback("");
    setMessage("힉스필드 결과물을 학습 기록으로 저장했습니다. 좋은 결과인지 평가해주세요.");
    loadLearningInsights(selectedFormat);
  }

  function generateAvatarReference() {
    setReferenceNames((current) => {
      const generated = `AI 트레이너 레퍼런스 - ${avatarImagePrompt.slice(0, 18)}.png`;
      return [generated, ...current.filter((name) => !name.startsWith("AI 트레이너 레퍼런스"))].slice(0, 9);
    });
    setMessage("");
  }

  function generatePoseGuideImage() {
    setPoseGuideName(`AI 동작 가이드 - ${poseGuidePrompt.slice(0, 18)}.png`);
    setMessage("");
  }

  async function generateVideo() {
    setMessage("");

    if (selectedFormat === "D" && !poseGuideName) {
      setMessage("AI 운동 시연은 포즈 가이드 이미지를 먼저 업로드해야 합니다.");
      return;
    }

    if (selectedFormat === "D" && referenceNames.length === 0) {
      setMessage("AI 운동 시연은 모델/체형 레퍼런스 이미지를 1장 이상 업로드해야 합니다.");
      return;
    }

    if (!script.trim()) {
      setMessage("영상에 사용할 프롬프트를 입력해주세요.");
      return;
    }

    if (script.length > 1500) {
      setMessage("프롬프트는 최대 1500자까지 입력할 수 있습니다.");
      return;
    }

    // 목소리 없이 보내면 서버가 400으로 돌려준다. 그 왕복을 여기서 아낀다.
    if (!activeVoiceId) {
      setMessage("내 목소리를 먼저 등록하고 선택해주세요.");
      return;
    }

    setVideoStatus("processing");
    setLearningRecordId("");
    setLearningFeedback("");
    setResultUrl("");
    setResultAudioUrl("");
    setDisplayProgress(0);
    setProgress(12);

    const response = await fetch("/api/projects", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ script, voiceReferenceId: activeVoiceId }),
    });

    if (response.status === 401) {
      window.location.href = '/login';
      return;
    }

    const data = await response.json();

    if (!response.ok) {
      setVideoStatus("failed");
      setMessage(data.error ?? "영상 생성 요청에 실패했습니다.");
      return;
    }

    setJobId(data.jobId);
    setLearningRecordId(data.learningRecordId ?? "");
    loadLearningInsights(selectedFormat);
    pollVideoStatus(data.jobId);
  }

  async function pollVideoStatus(nextJobId: string) {
    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      const elapsed = Date.now() - startedAt;
      const response = await fetch(`/api/jobs/${nextJobId}`);

      if (response.status === 401) {
        window.clearInterval(timer);
        window.location.href = "/login";
        return;
      }

      const data = await response.json();

      if (!response.ok) {
        window.clearInterval(timer);
        setVideoStatus("failed");
        setMessage(data.error ?? "영상 상태 확인에 실패했습니다.");
        return;
      }

      setProgress(data.progress);

      if (data.status === "completed") {
        window.clearInterval(timer);
        setProgress(100);
        // 완료라고 하면서 주소가 없으면 보여줄 게 없다. 성공인 척하지 않는다.
        if (!data.resultUrl) {
          setVideoStatus("failed");
          setMessage("영상은 만들어졌지만 주소를 받지 못했습니다. 운영자에게 문의해주세요.");
          return;
        }
        setVideoStatus("completed");
        setResultUrl(data.resultUrl);
        setLearningRecordId(data.learningRecordId ?? learningRecordId);
        loadLearningInsights(selectedFormat);
      }

      if (data.status === "failed" || elapsed > 10 * 60 * 1000) {
        window.clearInterval(timer);
        setVideoStatus("failed");
        setMessage(data.error ?? "생성 시간이 초과되었습니다. 다시 시도해주세요.");
      }
    }, 1000);
  }

  async function previewVoice() {
    if (voiceInputMode !== "clone" || !activeVoiceId) {
      setMessage("먼저 저장된 목소리를 선택해주세요.");
      return;
    }

    const sampleText = (script.trim() || voiceReferenceText || "안녕하세요. 오늘 수업 팁을 알려드릴게요.").slice(0, 120);
    setPreviewStatus("loading");
    setPreviewAudioUrl("");
    setPreviewProgress(8);
    setPreviewDisplayProgress(0);
    setPreviewStatusValue("loading_model");

    let generationId = "";
    try {
      const response = await fetch("/api/voicebox/preview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: sampleText,
          profileId: activeVoiceId,
          language: "ko",
          instruct: TONE_INSTRUCT[tone],
        }),
      });
      const data = await response.json();

      if (!response.ok || !data.generationId) {
        setPreviewStatus("error");
        setMessage(data.error ?? "미리듣기 음성 생성에 실패했습니다. Fish Audio 설정을 확인해주세요.");
        return;
      }

      generationId = data.generationId;
      if (data.status) setPreviewStatusValue(String(data.status).toLowerCase());
      if (data.audioUrl) {
        setPreviewAudioUrl(data.audioUrl);
        setPreviewProgress(100);
        setPreviewStatus("ready");
        return;
      }
    } catch {
      setPreviewStatus("error");
      setMessage("미리듣기 음성 생성 중 오류가 발생했습니다.");
      return;
    }

    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      if (Date.now() - startedAt > 90 * 1000) {
        window.clearInterval(timer);
        setPreviewStatus("error");
        setMessage("미리듣기 음성 생성 시간이 초과되었습니다. 다시 시도해주세요.");
        return;
      }

      try {
        const response = await fetch(`/api/voicebox/preview/status/${generationId}`);
        const data = await response.json();
        const status = String(data.status ?? "").toLowerCase();
        setPreviewStatusValue(status);

        if (status === "completed" || status === "done" || status === "ready") {
          window.clearInterval(timer);
          setPreviewAudioUrl(data.audioUrl ?? "");
          setPreviewProgress(100);
          setPreviewStatus("ready");
          return;
        }

        if (status === "error" || status === "failed") {
          window.clearInterval(timer);
          setPreviewStatus("error");
          setMessage(data.error || "미리듣기 음성 생성에 실패했습니다. Fish Audio 설정을 확인해주세요.");
          return;
        }

        const target = status === "loading_model" ? 55 : status === "generating" ? 90 : 25;
        setPreviewProgress(target);
      } catch {
        // 일시적인 조회 실패는 다음 폴링에서 회복될 수 있습니다.
      }
    }, 700);
  }

  async function submitLearningFeedback(feedback: "good" | "bad") {
    if (!learningRecordId && !jobId) {
      setMessage("먼저 영상을 생성한 뒤 결과를 평가해주세요.");
      return;
    }

    const response = await fetch("/api/learning/feedback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        learningRecordId,
        jobId,
        feedback,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setMessage(data.error ?? "학습 평가 저장에 실패했습니다.");
      return;
    }

    setLearningFeedback(feedback);
    setMessage(feedback === "good" ? "좋은 결과로 학습했습니다. 다음 추천에 반영됩니다." : "아쉬운 결과로 저장했습니다. 같은 조합은 낮게 추천합니다.");
    loadLearningInsights(selectedFormat);
  }

  function downloadMock() {
    const content = `오토사장 MVP 결과\nformat=${selectedFormat}\njob=${jobId}\nplatform=${platform}\nvideo=${resultUrl || "mock-video-url"}`;
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `autosajang-format-${selectedFormat.toLowerCase()}-${platform}-${jobId || "demo"}.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="appShell">
      <header className="topbar">
        <div className="brand">
          <div className="brandMark">오</div>
        </div>
        <nav className="globalNav" aria-label="주요 메뉴">
          <button className={selectedFormat === "A" ? "active" : ""} onClick={() => selectFormat("A")} type="button">
            아바타 릴스 <b>MVP</b>
          </button>
          <button className={selectedFormat === "D" ? "active" : ""} onClick={() => selectFormat("D")} type="button">
            AI 운동 시연 <b>Seedance</b>
          </button>
        </nav>
        <div className="accountActions">
          <button className="loginButton" type="button">{selectedFormat === "D" ? "AI 운동 시연" : "아바타 릴스"}</button>
          <button className="signupButton" type="button">{selectedFormat === "D" ? "동작 영상 만들기" : "첫 영상 만들기"}</button>
        </div>
      </header>

      <main className="main">
        <aside className="creatorPanel" aria-label="영상 생성 패널">
          <div className="panelTabs">
            <button className="active" type="button">영상 만들기</button>
            <button className="pending" disabled type="button">영상 편집 <span>준비중</span></button>
            <button className="pending" disabled type="button">모션 제어 <span>준비중</span></button>
          </div>

          <div className="presetBanner">
            <div>
              <strong>{isExerciseMode ? "운동 시연 프리셋" : "아바타 릴스 프리셋"}</strong>
              <span>{isExerciseMode ? "트레이너 이미지 + 동작 가이드 + Seedance" : "얼굴 아바타 + 내 목소리 + 자동 자막"}</span>
            </div>
            <em>베타</em>
          </div>

          {selectedFormat === "A" && (
            <div className="flowBuilder" aria-label="아바타 릴스 제작 순서">
              <div className="builderHeader">
                <span>제작 흐름</span>
                <strong>얼굴 등록 → 목소리 준비 → 음성 합성 → 영상 생성</strong>
              </div>

              <div className="builderStep">
                <div className="builderStepTitle">
                  <span>1</span>
                  <strong>아바타 만들기</strong>
                </div>
                <div className="stepStatusLine">
                  <b>{avatar.id ? "완료" : "필요"}</b>
                  <span>{avatar.fileName || "JPG/PNG 얼굴 사진 업로드"}</span>
                </div>
              </div>

              <div className="builderStep">
                <div className="builderStepTitle">
                  <span>2</span>
                  <strong>목소리 방식 선택</strong>
                </div>
                <div className="stepStatusLine">
                  <b>{activeVoiceId || narrationAudioName ? "완료" : "필요"}</b>
                  <span>{narrationAudioName || selectedVoiceProfile?.name || voice.fileName || "저장된 목소리 선택 또는 전체 녹음 업로드"}</span>
                </div>
              </div>

              <div className="builderStep compact">
                <div className="builderStepTitle">
                  <span>3</span>
                  <strong>대본으로 아바타 릴스 생성</strong>
                </div>
                <p>저장된 목소리로 음성을 먼저 만들고, 아바타 영상 생성으로 이어집니다.</p>
              </div>
            </div>
          )}

          {selectedFormat === "D" && (
            <div className="flowBuilder exercise" aria-label="AI 운동 시연 제작 순서">
              <div className="builderHeader">
                <span>한 번에 만들기</span>
                <strong>트레이너 이미지 → 동작 가이드 → 힉스필드 생성 → 결과 학습</strong>
              </div>

              <div className="builderStep">
                <div className="builderStepTitle">
                  <span>1</span>
                  <strong>트레이너 이미지 만들기</strong>
                </div>
                <textarea
                  value={avatarImagePrompt}
                  onChange={(event) => setAvatarImagePrompt(event.target.value)}
                  aria-label="트레이너 이미지 프롬프트"
                />
                <button type="button" onClick={generateAvatarReference}>트레이너 이미지 생성</button>
              </div>

              <div className="builderStep">
                <div className="builderStepTitle">
                  <span>2</span>
                  <strong>동작 가이드 만들기</strong>
                </div>
                <textarea
                  value={poseGuidePrompt}
                  onChange={(event) => setPoseGuidePrompt(event.target.value)}
                  aria-label="동작 가이드 이미지 프롬프트"
                />
                <button type="button" onClick={generatePoseGuideImage}>동작 가이드 생성</button>
              </div>

              <div className="builderStep compact">
                <div className="builderStepTitle">
                  <span>3</span>
                  <strong>힉스필드에서 시연 영상 생성</strong>
                </div>
                <p>프롬프트를 복사해 힉스필드에 넣고, 완성 MP4를 다시 업로드해 학습합니다.</p>
              </div>
            </div>
          )}

          <div className="uploadDeck">
            <div className="uploadIcons">
              <span>{isExerciseMode ? "POSE" : "FACE"}</span>
              <span>{isExerciseMode ? "REF" : "VOICE"}</span>
              <span>{isExerciseMode ? "MP4" : "AUDIO"}</span>
            </div>
            <strong>{isExerciseMode ? "운동 리소스 업로드" : "아바타/목소리 업로드"}</strong>
            <div className="fileInputs">
              {isExerciseMode ? (
                <>
                  <label>
                    포즈 가이드
                    <input type="file" accept="image/png,image/jpeg" onChange={handlePoseGuideUpload} />
                  </label>
                  <label>
                    레퍼런스
                    <input multiple type="file" accept="image/png,image/jpeg" onChange={handleReferenceUpload} />
                  </label>
                  <label>
                    추가 리소스
                    <input type="file" accept="image/png,image/jpeg" onChange={handlePoseGuideUpload} />
                  </label>
                  <label>
                    완성 MP4
                    <input type="file" accept="video/mp4" onChange={importHiggsfieldResult} />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    아바타
                    <input type="file" accept="image/png,image/jpeg" onChange={createAvatar} />
                  </label>
                  {voiceInputMode === "clone" ? (
                    <label>
                      목소리 원본
                      <input type="file" accept="audio/wav,audio/mpeg,audio/mp3" onChange={createVoice} />
                    </label>
                  ) : (
                    <label>
                      전체 녹음
                      <input type="file" accept="audio/wav,audio/mpeg,audio/mp3" onChange={handleNarrationUpload} />
                    </label>
                  )}
                </>
              )}
            </div>
            {selectedFormat === "A" && (
              <div className="uploadGuide" aria-label="아바타와 목소리 업로드 가이드">
                <div className="voiceModeSelector" aria-label="목소리 방식 선택">
                  <button
                    className={voiceInputMode === "clone" ? "active" : ""}
                    onClick={() => setVoiceInputMode("clone")}
                    type="button"
                  >
                    <strong>내목소리로 생성</strong>
                  </button>
                  <button
                    className={voiceInputMode === "recording" ? "active" : ""}
                    onClick={() => setVoiceInputMode("recording")}
                    type="button"
                  >
                    <strong>전체 녹음 사용</strong>
                  </button>
                </div>
                {voiceInputMode === "clone" ? (
                  <>
                    <div className="voiceboxConnection">
                      <strong>Fish Audio</strong>
                      <span>
                        {voiceboxStatus === "connected"
                          ? `연결됨 · 저장된 목소리 ${voiceProfiles.length}개`
                          : voiceboxStatus === "checking"
                            ? "연결 확인 중"
                            : "설정 필요 · FISH_API_KEY를 .env.local에 추가해주세요"}
                      </span>
                    </div>
                    {voiceProfiles.length > 0 && (
                      <label className="voiceProfilePicker">
                        <strong>저장된 목소리</strong>
                        <select
                          value={selectedVoiceProfileId}
                          onChange={(event) => {
                            const profileId = event.target.value;
                            const profile = voiceProfiles.find((item) => item.id === profileId);
                            setSelectedVoiceProfileId(profileId);
                            setVoice({
                              fileName: profile?.name || "저장된 목소리",
                              id: profileId,
                              previewUrl: "",
                              status: "completed",
                              error: "",
                            });
                          }}
                        >
                          {voiceProfiles.map((profile) => (
                            <option key={profile.id} value={profile.id}>
                              {profile.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label className="referenceScript">
                      <strong>샘플 대본</strong>
                      <textarea
                        value={voiceReferenceText}
                        onChange={(event) => setVoiceReferenceText(event.target.value)}
                        placeholder="목소리 원본에서 실제로 말한 문장을 그대로 입력하세요."
                      />
                    </label>
                  </>
                ) : (
                  <div>
                    <strong>전체 녹음</strong>
                    <span>{narrationAudioName || "WAV/MP3 업로드"}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {isExerciseMode && (
            <div className="higgsfieldPanel" aria-label="힉스필드 작업 연결">
              <div className="higgsfieldHeader">
                <span>힉스필드 베타 작업</span>
                <strong>{higgsfieldResultName || "결과 MP4 대기"}</strong>
              </div>
              <div className="higgsfieldActions">
                <button onClick={copyHiggsfieldPrompt} type="button">프롬프트 복사</button>
                <button onClick={openHiggsfield} type="button">힉스필드 열기</button>
                <label>
                  결과 업로드
                  <input type="file" accept="video/mp4" onChange={importHiggsfieldResult} />
                </label>
              </div>
              <textarea readOnly value={activeHiggsfieldPrompt} aria-label="힉스필드용 프롬프트 미리보기" />
              <div className="higgsfieldChecklist">
                {activeHiggsfieldChecklist.map((item) => (
                  <span key={item}>✓ {item}</span>
                ))}
              </div>
            </div>
          )}

          <div className="promptBox">
            <label htmlFor="script">{isExerciseMode ? "동작 영상 프롬프트" : "릴스 대본"}</label>
            <textarea
              id="script"
              maxLength={1500}
              value={script}
              onChange={(event) => updateScript(event.target.value)}
              placeholder={isExerciseMode ? "운동 종류, 동작 속도, 카메라 앵글, 배경 스타일을 입력하세요." : "아바타가 말할 내용을 그대로 적어주세요."}
            />
            <div className="promptTools">
              <button type="button">@ 요소</button>
              <button type="button">사운드 켬</button>
              <span>{script.length}/1500</span>
            </div>
            {message && <p className="errorText">{message}</p>}
          </div>

          <button className="modelSelect" type="button">
            <span>
              <small>모델</small>
              <strong>{isExerciseMode ? "힉스필드 운동 시연" : "아바타 릴스 생성"}</strong>
            </span>
            <span className="modelBars" />
          </button>

          {videoStatus === "processing" && (
            <div className="progressPanel" aria-label="영상 생성 진행률">
              <div className="progressMeta">
                <span className="progressStage">{stageLabel}</span>
                <span className="progressPercent">{roundedProgress}%</span>
              </div>
              <div className="progressTrack">
                <div className="progressFill" style={{ width: `${roundedProgress}%` }} />
              </div>
            </div>
          )}

          <div className="settingPanel" aria-label="영상 출력 설정">
            {isExerciseMode ? (
              <div className="settingGroup">
                <span>영상 길이</span>
                <div className="segmentedControl">
                  {(["8s", "12s", "15s"] as DurationOption[]).map((option) => (
                    <button
                      className={duration === option ? "active" : ""}
                      key={option}
                      onClick={() => setDuration(option)}
                      type="button"
                    >
                      {option}
                    </button>
                  ))}
                </div>
                <p>힉스필드 단일 클립은 4~15초 기준으로 준비합니다.</p>
              </div>
            ) : (
              <div className="settingGroup">
                <span>말하기 속도</span>
                <div className="speedSlider">
                  <input
                    aria-label="말하기 속도"
                    max="3"
                    min="1"
                    onChange={(event) => setSpeakingSpeed(Number(event.target.value))}
                    step="1"
                    type="range"
                    value={speakingSpeed}
                  />
                  <div>
                    <span>천천히</span>
                    <strong>{speakingSpeed === 1 ? "천천히" : speakingSpeed === 2 ? "보통" : "빠르게"}</strong>
                    <span>빠르게</span>
                  </div>
                </div>
                <p>대본 기준 예상 길이 약 {estimatedTalkSeconds}초</p>
              </div>
            )}

            {!isExerciseMode && (
              <div className="settingGroup">
                <span>톤 선택</span>
                <div className="toneSelector">
                  {([
                    ["friendly", "친근한"],
                    ["expert", "전문가"],
                    ["energetic", "활기찬"],
                    ["calm", "차분한"],
                  ] as [ToneOption, string][]).map(([option, label]) => (
                    <button
                      className={tone === option ? "active" : ""}
                      key={option}
                      onClick={() => setTone(option)}
                      type="button"
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="tonePreviewControl">
                  <button
                    className="previewVoiceButton"
                    type="button"
                    onClick={previewVoice}
                    disabled={previewStatus === "loading"}
                  >
                    {previewStatus === "loading" ? "생성 중…" : "▶ 이 톤으로 미리듣기"}
                  </button>
                  {previewStatus === "loading" && (
                    <div className="previewProgress">
                      <div className="progressMeta">
                        <span className="progressStage">{previewStageLabel(previewStatusValue)}</span>
                        <span className="progressPercent">{Math.round(previewDisplayProgress)}%</span>
                      </div>
                      <div className="progressTrack">
                        <div className="progressFill" style={{ width: `${previewDisplayProgress}%` }} />
                      </div>
                    </div>
                  )}
                  {previewStatus === "ready" && previewAudioUrl && (
                    <audio className="previewVoiceAudio" src={previewAudioUrl} controls autoPlay />
                  )}
                </div>
              </div>
            )}

            <div className="settingGroup">
              <span>자막</span>
              <div className="segmentedControl two">
                <button className={captionMode === "auto" ? "active" : ""} onClick={() => setCaptionMode("auto")} type="button">
                  자동
                </button>
                <button className={captionMode === "off" ? "active" : ""} onClick={() => setCaptionMode("off")} type="button">
                  끔
                </button>
              </div>
            </div>

            <div className="settingGroup">
              <span>화질</span>
              <div className="segmentedControl quality">
                {(["1080p", "2k", "4k"] as QualityOption[]).map((option) => (
                  <button
                    className={quality === option ? "active" : ""}
                    key={option}
                    onClick={() => setQuality(option)}
                    type="button"
                  >
                    {option === "4k" ? "4K" : option}
                  </button>
                ))}
              </div>
              {quality === "4k" && <p>4K는 업스케일 단계가 추가되어 시간이 더 걸립니다.</p>}
            </div>
          </div>

          <div className="statusStack">
            {selectedFormat === "D" ? (
              <>
                <StatusRow label="동작 가이드" value={poseGuideName || "대기 중"} done={Boolean(poseGuideName)} />
                <StatusRow label="트레이너 레퍼런스" value={referenceNames.length ? `${referenceNames.length}장 준비됨` : "대기 중"} done={referenceNames.length > 0} />
                <StatusRow label="힉스필드 결과" value={higgsfieldResultName || "MP4 업로드 대기"} done={Boolean(higgsfieldResultName)} />
              </>
            ) : (
              <>
                <StatusRow label="아바타" value={avatar.id ? "준비됨" : avatar.error || "대기 중"} done={Boolean(avatar.id)} />
                <StatusRow
                  label="목소리"
                  value={voiceInputMode === "recording" ? narrationAudioName || "전체 녹음 대기 중" : activeVoiceId ? selectedVoiceProfile?.name || "준비됨" : voice.error || "대기 중"}
                  done={hasVoiceInput}
                />
                <StatusRow label="음성" value={resultAudioUrl ? "생성됨" : usesRecordedNarration ? "전체 녹음 사용" : "생성 전"} done={Boolean(resultAudioUrl) || usesRecordedNarration} />
              </>
            )}
            <StatusRow label="렌더링" value={statusLabel(videoStatus)} done={videoStatus === "completed"} />
          </div>

          <div className="readyChecklist" aria-label="생성 전 준비 상태">
            {readyItems.map((item) => (
              <span className={item.done ? "done" : ""} key={item.label}>
                {item.done ? "✓" : "·"} {item.label}
              </span>
            ))}
          </div>

          {/*
            생성 버튼 **바로 위**에 둔다. 이 안내가 하는 일은 "내 캐릭터가 아니다"를 발행 전에
            알아채게 하는 것 하나뿐이고, 앱 안에서 알아채지 못하면 남의 얼굴이 내 이름으로
            나간 뒤에 시청자가 먼저 알게 된다 — 이 저장소가 목소리에서 이미 한 번 겪은 실패다.
          */}
          <section className="characterPanel" aria-label="릴스에 들어갈 캐릭터">
            {usingPresetCharacter ? (
              <div className="presetCharacterNotice" role="status">
                <span className="presetCharacterFlag">기본 캐릭터 사용 중</span>
                <strong>지금 만들면 내 캐릭터가 아닙니다</strong>
                <p>
                  아직 올린 캐릭터가 없어서, 캐릭터가 필요한 장면에는 운영자가 만들어 둔 기본
                  캐릭터가 대신 들어갑니다. 이대로 발행하면 내 얼굴이 아닌 캐릭터가 내 이름으로
                  나갑니다.
                </p>
                <p>강의에서 만든 내 캐릭터를 아래에서 올리면, 그때부터 내 캐릭터만 쓰입니다.</p>
                {presetKeywords.length > 0 && (
                  <>
                    <div className="presetCharacterKeywords">
                      {presetKeywords.slice(0, PRESET_KEYWORD_PREVIEW_COUNT).map((keyword) => (
                        <span key={keyword}>{keyword}</span>
                      ))}
                      {hiddenPresetCount > 0 && <span className="more">외 {hiddenPresetCount}개</span>}
                    </div>
                    {/*
                      프리셋은 그림을 띄우지 않는다. 프리셋 항목의 `file`은 운영자 Codex 스킬
                      디렉터리 기준 경로라 브라우저에서 열 수 없고, `<img>`로 걸면 전부 깨진
                      이미지가 된다 — "앱이 고장났다"로 읽혀서, 정작 믿어야 할 이 안내까지
                      같이 의심받는다. 낱말은 텍스트라 항상 정확하고, 무엇이 캐릭터를 불러내는지도
                      같이 알려 준다.
                    */}
                    <small>
                      대본에 이 낱말이 나오는 장면에 기본 캐릭터가 들어갑니다. 기본 캐릭터 그림
                      파일은 운영자 컴퓨터에만 있어 여기서는 미리보기를 띄우지 못합니다.
                    </small>
                  </>
                )}
              </div>
            ) : myCharacters.length > 0 ? (
              <div className="myCharacterList">
                <div className="myCharacterHeader">
                  <span>내 캐릭터</span>
                  <strong>{myCharacters.length}개</strong>
                </div>
                <p>내 캐릭터만 쓰입니다. 기본 캐릭터는 더 이상 들어가지 않습니다.</p>
                <ul>
                  {myCharacters.map((entry) => (
                    <li key={entry.id}>
                      <img alt="" src={studentClipartSrc(entry.file)} />
                      <div>
                        <strong>{entry.keyword}</strong>
                        <span>{entry.aliases.length ? entry.aliases.join(", ") : "비슷한 말 없음"}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="characterUpload">
              <strong>내 캐릭터 올리기</strong>

              <label className="characterFilePick">
                <input accept="image/png" onChange={selectCharacterFile} type="file" />
                <span>{characterFileName || "투명 배경 PNG 고르기"}</span>
              </label>
              <p className="characterHint">
                캐릭터는 영상 위에 얹히기 때문에 배경이 투명한 PNG만 받습니다.
              </p>

              <label className="characterField">
                <span>키워드</span>
                <input
                  onChange={(event) => setCharacterKeyword(event.target.value)}
                  placeholder="예: 스쿼트"
                  value={characterKeyword}
                />
              </label>
              <p className="characterHint">
                대본에 이 낱말이 나오는 장면에 이 캐릭터가 들어갑니다. 대본에서 실제로 쓰는
                낱말로, 2글자 이상 적어주세요 — 한 글자는 다른 낱말 속에 우연히 걸립니다.
              </p>

              <label className="characterField">
                <span>비슷한 말</span>
                <input
                  onChange={(event) => setCharacterAliases(event.target.value)}
                  placeholder="선택 · 쉼표로 구분 · 예: 하체, 앉았다 일어서기"
                  value={characterAliases}
                />
              </label>

              <label className="characterField">
                <span>분류</span>
                <input
                  onChange={(event) => setCharacterCategory(event.target.value)}
                  placeholder="선택 · 예: 운동"
                  value={characterCategory}
                />
              </label>

              <button
                className="characterUploadButton"
                disabled={characterUploadStatus === "uploading"}
                onClick={uploadClipart}
                type="button"
              >
                {characterUploadStatus === "uploading" ? "올리는 중…" : "내 캐릭터 올리기"}
              </button>

              {characterError && (
                <p className="characterError" role="alert">{characterError}</p>
              )}
              {characterUploadStatus === "done" && !characterError && characterDoneMessage && (
                <p className="characterDone" role="status">{characterDoneMessage}</p>
              )}
            </div>
          </section>

          <div className="learningPanel" aria-label="학습 인사이트">
            <div className="learningHeader">
              <span>학습 인사이트</span>
              <strong>{learningInsights?.total ?? 0}건 누적</strong>
            </div>
            <p>{learningInsights?.recommendation ?? "생성 결과와 평가가 쌓이면 추천 프리셋이 자동으로 정리됩니다."}</p>
            <div className="learningSignals">
              {(learningInsights?.signals ?? ["결과 대기", "평가 대기", "추천 대기"]).map((signal) => (
                <span key={signal}>{signal}</span>
              ))}
            </div>
            {learningInsights?.bestPrompt && (
              <button className="reusePromptButton" onClick={() => updateScript(learningInsights.bestPrompt)} type="button">
                잘 나온 프롬프트 불러오기
              </button>
            )}
          </div>

          <button className="generateButton" onClick={isExerciseMode ? copyHiggsfieldPrompt : generateVideo} type="button">
            {isExerciseMode ? "힉스필드 프롬프트 복사" : "아바타 릴스 만들기"}
            {videoStatus === "processing" && <span>{roundedProgress}%</span>}
          </button>
        </aside>

        <section className="canvasArea" aria-label="영상 생성 작업 영역">
          <div className="canvasToolbar">
            <button className="pending" disabled type="button">작업 기록 <span>준비중</span></button>
            <button className="active" type="button">사용 방법</button>
          </div>

          <div className="heroCanvas">
            <div className="heroContent">
              <h1>{isExerciseMode ? "운동 동작을 AI 시연 영상으로 만드세요" : "아바타가 말하는 릴스를 만드세요"}</h1>
              <p>
                {isExerciseMode
                  ? "트레이너 이미지와 포즈 가이드로 시연 영상을 만듭니다."
                  : "얼굴 사진과 목소리 파일을 힉스필드 토킹 아바타 영상으로 만듭니다."}
              </p>
            </div>

            <div className="workflowStage">
              <div className={`previewCard ${activeStepCard === 0 ? "activeStep" : ""}`}>
                {activeStepCard === 0 && videoStatus !== "completed" && (
                  <span className="nextStepBadge">다음 단계</span>
                )}
                <div className={selectedFormat === "D" ? "videoPreview formatDPreview" : `videoPreview talkingPreview ${avatar.previewUrl ? "avatarPreviewSurface" : ""}`}>
                  {selectedFormat === "A" && avatar.previewUrl ? (
                    <img className="avatarPhotoPreview" src={avatar.previewUrl} alt="업로드한 아바타 미리보기" />
                  ) : selectedFormat === "A" ? (
                    <img
                      className="avatarExamplePhoto"
                      src="/images/pilates-talking-avatar.png"
                      alt="여성 필라테스 강사 예시"
                    />
                  ) : (
                    <img
                      className="trainerExamplePhoto"
                      src="/images/trainer-exercise-demo.png"
                      alt="남성 트레이너 덤벨컬 시연 예시"
                    />
                  )}
                  {isExerciseMode && <div className="motionTitle">덤벨컬 동작 가이드</div>}
                  {(!avatar.previewUrl || selectedFormat === "D") && (
                    <div className="captionBars">
                      <span />
                      <span />
                    </div>
                  )}
                </div>
                <div className="offerBadges">
                  <span>{isExerciseMode ? "Seedance" : "아바타"}</span>
                  <span>{isExerciseMode ? "Higgsfield" : "Voice"}</span>
                </div>
                <h2>{isExerciseMode ? "동작 리소스 기반 영상 생성" : "아바타 토킹 릴스 생성"}</h2>
                <p>
                  {isExerciseMode
                    ? "가이드와 레퍼런스를 힉스필드 프롬프트로 정리합니다."
                    : "아바타와 목소리로 세로 릴스를 만듭니다."}
                </p>
              </div>

              <div className="dashedSlot">
                <span>프롬프트 복사</span>
              </div>

              <div className={`stepCard ${activeStepCard === 1 ? "activeStep" : ""}`}>
                {activeStepCard === 1 && videoStatus !== "completed" && (
                  <span className="nextStepBadge">다음 단계</span>
                )}
                {isExerciseMode ? (
                  <div className="exerciseResourcePreview">
                    <img src="/images/trainer-exercise-demo.png" alt="AI 운동 시연 리소스 준비 예시" />
                    <div className="exerciseGuideOverlay">
                      <span>포즈 가이드</span>
                      <strong>정확한 덤벨컬 자세</strong>
                      <p>정면 트레이너 이미지와 동작 가이드를 함께 넣어 시연 영상을 만듭니다.</p>
                      <div>
                        <b>정면</b>
                        <b>팔꿈치 고정</b>
                        <b>반복 동작</b>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="tonePreview">
                    <img src="/images/pilates-talking-avatar.png" alt="대본과 톤 선택 예시" />
                    <div className="toneOverlay">
                      <span>톤 선택</span>
                      <strong>차분한 전문가 톤</strong>
                      <p>오늘은 허리가 편해지는 필라테스 호흡법을 알려드릴게요.</p>
                      <div>
                        <b>친근함</b>
                        <b>전문가</b>
                        <b>자동 자막</b>
                      </div>
                    </div>
                  </div>
                )}
                <h3>{isExerciseMode ? "리소스 준비" : "대본과 톤 선택"}</h3>
                <p>
                  {isExerciseMode
                    ? "포즈 가이드와 레퍼런스를 입력값으로 사용합니다."
                    : "말할 내용만 적으면 자동 자막·비율을 맞춰 렌더링합니다."}
                </p>
              </div>

              <div className={`stepCard output ${activeStepCard === 2 ? "activeStep" : ""} ${!isExerciseMode && videoStatus === "completed" && resultUrl ? "fullPreview" : ""}`}>
                {activeStepCard === 2 && videoStatus !== "completed" && (
                  <span className="nextStepBadge">다음 단계</span>
                )}
                <div className="outputFrame">
                  {isExerciseMode && higgsfieldPreviewUrl ? (
                    /*
                     * 학생이 힉스필드에서 직접 만들어 업로드한 실제 MP4.
                     * 서버에는 파일명만 기록되므로(업로드된 실체 없음), 여기서는
                     * 브라우저가 들고 있는 File로 만든 오브젝트 URL을 그대로 튼다 —
                     * 남의 스톡 사진을 "완성"이라고 보여줬던 결함의 재발 방지.
                     */
                    <div className="outputReelPreview exerciseOutputPreview">
                      <video
                        className="outputVideoPreview"
                        src={higgsfieldPreviewUrl}
                        controls
                        playsInline
                      />
                    </div>
                  ) : isExerciseMode ? (
                    <div className="outputReelPreview exerciseOutputPreview">
                      <img
                        className="outputExamplePhoto"
                        src="/images/trainer-exercise-demo.png"
                        alt="운동 시연 완성 예시"
                      />
                      <div className="outputCaption">
                        <span>완성 예시</span>
                        <strong>덤벨컬 동작 가이드</strong>
                      </div>
                    </div>
                  ) : videoStatus === "completed" && resultUrl ? (
                    <div className="outputReelPreview">
                      <video
                        className="outputVideoPreview"
                        src={resultUrl}
                        controls
                        playsInline
                      />
                    </div>
                  ) : videoStatus === "completed" || videoStatus === "failed" ? (
                    /*
                     * 결과 URL이 없는데도 예시 사진을 "완성"이라고 붙여 내보내면
                     * 수강생은 남의 스톡 사진을 자기 결과물로 받는다. 오류가 낫다.
                     */
                    <div className="outputReelPreview outputErrorState">
                      <strong>영상을 만들지 못했습니다</strong>
                      <p>{message || "완성된 영상 주소를 받지 못했습니다. 다시 시도해주세요."}</p>
                    </div>
                  ) : (
                    <div className="outputReelPreview">
                      <img
                        className="outputExamplePhoto"
                        src="/images/pilates-talking-avatar.png"
                        alt="완성된 아바타 릴스 예시 이미지"
                      />
                      <div className="outputCaption">
                        <span>완성 예시</span>
                        <strong>오늘의 필라테스 팁</strong>
                      </div>
                    </div>
                  )}
                </div>
                <h3>
                  {isExerciseMode
                    ? higgsfieldPreviewUrl
                      ? "업로드한 결과물"
                      : "운동 시연 완성 예시"
                    : "아바타 릴스 완성"}
                </h3>
                <p>
                  {isExerciseMode
                    ? higgsfieldPreviewUrl
                      ? "힉스필드에서 직접 만들어 업로드한 영상입니다."
                      : "힉스필드에서 직접 만든 15~20초 시연 영상을 업로드하면 여기에 표시됩니다."
                    : "완성 MP4를 릴스·쇼츠·틱톡 규격으로 내려받습니다."}
                </p>
              </div>
            </div>

            <div className="bottomStatus">
              <div>
                <span>작업</span>
                <strong>{jobId || "진행 중인 렌더링 없음"}</strong>
              </div>
              <div>
                <span>출력</span>
                <strong>{resultUrl || outputSizeLabel}</strong>
              </div>
              <div>
                <span>플랫폼</span>
                <select value={platform} onChange={(event) => setPlatform(event.target.value)}>
                  <option value="instagram">인스타 릴스</option>
                  <option value="youtube">유튜브 쇼츠</option>
                  <option value="tiktok">틱톡</option>
                </select>
              </div>
              <div className="resultFeedback">
                <span>결과 학습</span>
                <div>
                  <button
                    className={learningFeedback === "good" ? "active" : ""}
                    disabled={videoStatus !== "completed"}
                    onClick={() => submitLearningFeedback("good")}
                    type="button"
                  >
                    좋은 결과
                  </button>
                  <button
                    className={learningFeedback === "bad" ? "active" : ""}
                    disabled={videoStatus !== "completed"}
                    onClick={() => submitLearningFeedback("bad")}
                    type="button"
                  >
                    아쉬움
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function StatusRow({ label, value, done }: { label: string; value: string; done: boolean }) {
  return (
    <div className={`statusRow ${done ? "done" : ""}`}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}
