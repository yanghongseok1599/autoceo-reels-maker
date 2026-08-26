"use client";

import { ChangeEvent, useEffect, useState } from "react";

type JobStatus = "idle" | "uploading" | "processing" | "completed" | "failed";
type ContentFormat = "A" | "D";
type DurationOption = "15s" | "20s" | "30s";
type ToneOption = "friendly" | "expert" | "energetic" | "calm";
type QualityOption = "1080p" | "2k" | "4k";
type CaptionOption = "auto" | "off";
type VoiceboxStatus = "checking" | "connected" | "offline";

type VoiceProfileSummary = {
  id: string;
  name: string;
  voiceType?: string;
  sampleCount?: number;
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

function emptyUpload(): UploadState {
  return {
    fileName: "",
    id: "",
    previewUrl: "",
    status: "idle",
    error: "",
  };
}

function estimateTalkSeconds(script: string, speed: number) {
  const textLength = script.replace(/\s/g, "").length;
  const charsPerSecond = 4.4 + speed * 0.9;
  return Math.max(5, Math.ceil(textLength / charsPerSecond));
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
  const [avatarImagePrompt, setAvatarImagePrompt] = useState("남성 피트니스 모델, 검정 운동복, 정면/측면/후면 레퍼런스");
  const [poseGuidePrompt, setPoseGuidePrompt] = useState("덤벨컬 준비 자세, 수축 자세, 팔꿈치 고정 주의사항이 보이는 동작 가이드 시트");
  const [jobId, setJobId] = useState("");
  const [videoStatus, setVideoStatus] = useState<JobStatus>("idle");
  const [progress, setProgress] = useState(0);
  const [resultUrl, setResultUrl] = useState("");
  const [platform, setPlatform] = useState("instagram");
  const [duration, setDuration] = useState<DurationOption>("15s");
  const [speakingSpeed, setSpeakingSpeed] = useState(2);
  const [tone, setTone] = useState<ToneOption>("expert");
  const [captionMode, setCaptionMode] = useState<CaptionOption>("auto");
  const [quality, setQuality] = useState<QualityOption>("1080p");
  const [voiceProfiles, setVoiceProfiles] = useState<VoiceProfileSummary[]>([]);
  const [selectedVoiceProfileId, setSelectedVoiceProfileId] = useState("");
  const [voiceReferenceText, setVoiceReferenceText] = useState(starterVoiceReference);
  const [voiceboxStatus, setVoiceboxStatus] = useState<VoiceboxStatus>("checking");
  const [message, setMessage] = useState("");
  const script = scriptByFormat[selectedFormat];
  const isExerciseMode = selectedFormat === "D";
  const activeVoiceId = selectedVoiceProfileId || voice.id;
  const usesRecordedNarration = selectedFormat === "A" && Boolean(narrationAudioName);
  const selectedVoiceProfile = voiceProfiles.find((profile) => profile.id === activeVoiceId);
  const estimatedTalkSeconds = estimateTalkSeconds(script, speakingSpeed);
  const outputSizeLabel = {
    "1080p": "MP4 1080x1920",
    "2k": "MP4 1440x2560",
    "4k": "MP4 2160x3840",
  }[quality];

  useEffect(() => {
    return () => {
      if (avatar.previewUrl) {
        URL.revokeObjectURL(avatar.previewUrl);
      }
    };
  }, [avatar.previewUrl]);

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

  function selectFormat(format: ContentFormat) {
    setSelectedFormat(format);
    setMessage("");
  }

  function updateScript(value: string) {
    setScriptByFormat((current) => ({
      ...current,
      [selectedFormat]: value,
    }));
  }

  async function createAvatar(event: ChangeEvent<HTMLInputElement>) {
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

    const previewUrl = URL.createObjectURL(file);
    setAvatar({ fileName: file.name, id: "", previewUrl, status: "uploading", error: "" });
    const formData = new FormData();
    formData.append("photo", file);

    try {
      const response = await fetch("/api/avatar/create", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "아바타 생성에 실패했습니다.");
      }

      setAvatar({ fileName: file.name, id: data.avatarId, previewUrl, status: "completed", error: "" });
    } catch (error) {
      setAvatar({
        fileName: file.name,
        id: "",
        previewUrl,
        status: "failed",
        error: error instanceof Error ? error.message : "아바타 생성에 실패했습니다.",
      });
    }
  }

  async function createVoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["audio/wav", "audio/mpeg", "audio/mp3"].includes(file.type)) {
      setVoice({ ...emptyUpload(), fileName: file.name, error: "WAV 또는 MP3 파일만 업로드할 수 있습니다." });
      return;
    }

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

  function handleNarrationUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!["audio/wav", "audio/mpeg", "audio/mp3"].includes(file.type)) {
      setMessage("전체 녹음 파일은 WAV 또는 MP3만 업로드할 수 있습니다.");
      return;
    }

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

  function generateAvatarReference() {
    setReferenceNames((current) => {
      const generated = `AI 아바타 레퍼런스 - ${avatarImagePrompt.slice(0, 18)}.png`;
      return [generated, ...current.filter((name) => !name.startsWith("AI 아바타 레퍼런스"))].slice(0, 9);
    });
    setMessage("");
  }

  function generatePoseGuideImage() {
    setPoseGuideName(`AI 포즈 가이드 - ${poseGuidePrompt.slice(0, 18)}.png`);
    setMessage("");
  }

  async function generateVideo() {
    setMessage("");

    if (selectedFormat === "A" && !avatar.id) {
      setMessage("아바타 사진을 먼저 등록해주세요.");
      return;
    }

    if (selectedFormat === "A" && !activeVoiceId && !narrationAudioName) {
      setMessage("저장된 목소리를 선택하거나, 대본 전체를 읽은 녹음 파일을 업로드해주세요.");
      return;
    }

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

    setVideoStatus("processing");
    setProgress(12);
    let voiceAudioUrl = "";

    if (selectedFormat === "A" && !usesRecordedNarration) {
      setProgress(18);

      const ttsResponse = await fetch("/api/voicebox/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: script,
          profileId: activeVoiceId,
          language: "ko",
        }),
      });
      const ttsData = await ttsResponse.json();

      if (!ttsResponse.ok || ttsData.status === "error") {
        setVideoStatus("failed");
        setProgress(0);
        setMessage(ttsData.error ?? "Voicebox 음성 합성에 실패했습니다. Voicebox 앱이 실행 중인지 확인해주세요.");
        return;
      }

      voiceAudioUrl = ttsData.audioUrl ?? "";
      setProgress(34);
    }

    const response = await fetch("/api/video/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        format: selectedFormat === "D" ? "format_d" : "format_a",
        avatarId: avatar.id,
        voiceId: activeVoiceId,
        voiceAudioUrl,
        script,
        inputMode: usesRecordedNarration ? "audio" : "text",
        audioFileName: narrationAudioName,
        poseGuideName,
        referenceNames,
        duration: isExerciseMode ? duration : `${estimatedTalkSeconds}s`,
        speakingSpeed: isExerciseMode ? undefined : speakingSpeed,
        tone: isExerciseMode ? undefined : tone,
        captionMode,
        quality,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setVideoStatus("failed");
      setMessage(data.error ?? "영상 생성 요청에 실패했습니다.");
      return;
    }

    setJobId(data.jobId);
    pollVideoStatus(data.jobId);
  }

  async function pollVideoStatus(nextJobId: string) {
    const startedAt = Date.now();
    const timer = window.setInterval(async () => {
      const elapsed = Date.now() - startedAt;
      const response = await fetch(`/api/video/status/${nextJobId}`);
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
        setVideoStatus("completed");
        setResultUrl(data.videoUrl);
        setProgress(100);
      }

      if (data.status === "failed" || elapsed > 10 * 60 * 1000) {
        window.clearInterval(timer);
        setVideoStatus("failed");
        setMessage(data.error ?? "생성 시간이 초과되었습니다. 다시 시도해주세요.");
      }
    }, 2000);
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
          <button className="pricingButton" type="button">수강생 베타</button>
          <button className="loginButton" type="button">{selectedFormat === "D" ? "AI 운동 시연" : "아바타 릴스"}</button>
          <button className="signupButton" type="button">{selectedFormat === "D" ? "동작 영상 만들기" : "첫 영상 만들기"}</button>
        </div>
      </header>

      <main className="main">
        <aside className="creatorPanel" aria-label="영상 생성 패널">
          <div className="panelTabs">
            <button className="active" type="button">영상 만들기</button>
            <button type="button">영상 편집</button>
            <button type="button">모션 제어</button>
          </div>

          <div className="presetBanner">
            <div>
              <strong>{isExerciseMode ? "운동 시연 프리셋" : "아바타 릴스 프리셋"}</strong>
              <span>{isExerciseMode ? "AI 아바타 + 포즈 가이드 + Seedance" : "얼굴 아바타 + 내 목소리 + 자동 자막"}</span>
            </div>
            <button type="button">보기</button>
          </div>

          {selectedFormat === "A" && (
            <div className="flowBuilder" aria-label="아바타 릴스 제작 순서">
              <div className="builderHeader">
                <span>제작 흐름</span>
                <strong>얼굴 등록 → 목소리 등록 → 대본 작성 → 릴스 생성</strong>
              </div>

              <div className="builderStep">
                <div className="builderStepTitle">
                  <span>1</span>
                  <strong>아바타 만들기</strong>
                </div>
                <p>정면 얼굴 사진을 넣으면 촬영 없이 말하는 아바타를 준비합니다.</p>
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
                <p>저장된 목소리로 TTS를 만들거나, 대본 전체를 읽은 녹음 파일을 바로 사용할 수 있습니다.</p>
                <div className="stepStatusLine">
                  <b>{activeVoiceId || narrationAudioName ? "완료" : "필요"}</b>
                  <span>{narrationAudioName || selectedVoiceProfile?.name || voice.fileName || "저장된 목소리 선택 또는 전체 녹음 업로드"}</span>
                </div>
              </div>

              <div className="builderStep compact">
                <div className="builderStepTitle">
                  <span>3</span>
                  <strong>릴스 대본 작성</strong>
                </div>
                <p>운동 팁, 수업 홍보, 회원 후기처럼 말할 내용을 아래 프롬프트에 적습니다.</p>
              </div>
            </div>
          )}

          {selectedFormat === "D" && (
            <div className="flowBuilder exercise" aria-label="AI 운동 시연 제작 순서">
              <div className="builderHeader">
                <span>한 번에 만들기</span>
                <strong>아바타 이미지 → 포즈 가이드 → 시연 영상</strong>
              </div>

              <div className="builderStep">
                <div className="builderStepTitle">
                  <span>1</span>
                  <strong>AI 아바타 이미지 만들기</strong>
                </div>
                <textarea
                  value={avatarImagePrompt}
                  onChange={(event) => setAvatarImagePrompt(event.target.value)}
                  aria-label="AI 아바타 이미지 프롬프트"
                />
                <button type="button" onClick={generateAvatarReference}>아바타 이미지 생성</button>
              </div>

              <div className="builderStep">
                <div className="builderStepTitle">
                  <span>2</span>
                  <strong>포즈 가이드 이미지 만들기</strong>
                </div>
                <textarea
                  value={poseGuidePrompt}
                  onChange={(event) => setPoseGuidePrompt(event.target.value)}
                  aria-label="포즈 가이드 이미지 프롬프트"
                />
                <button type="button" onClick={generatePoseGuideImage}>포즈 가이드 생성</button>
              </div>

              <div className="builderStep compact">
                <div className="builderStepTitle">
                  <span>3</span>
                  <strong>Seedance 동작 영상 생성</strong>
                </div>
                <p>생성된 아바타 이미지와 포즈 가이드를 시연 영상 입력값으로 바로 사용합니다.</p>
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
            <p>{isExerciseMode ? "직접 만든 이미지가 있으면 여기서 교체할 수 있습니다." : "아바타 사진과 목소리 샘플을 먼저 등록하세요."}</p>
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
                </>
              ) : (
                <>
                  <label>
                    아바타
                    <input type="file" accept="image/png,image/jpeg" onChange={createAvatar} />
                  </label>
                  <label>
                    목소리
                    <input type="file" accept="audio/wav,audio/mpeg,audio/mp3" onChange={createVoice} />
                  </label>
                  <label>
                    전체 녹음
                    <input type="file" accept="audio/wav,audio/mpeg,audio/mp3" onChange={handleNarrationUpload} />
                  </label>
                </>
              )}
            </div>
            {selectedFormat === "A" && (
              <div className="uploadGuide" aria-label="아바타와 목소리 업로드 가이드">
                <div className="voiceboxConnection">
                  <strong>Voicebox 연결</strong>
                  <span>
                    {voiceboxStatus === "connected"
                      ? `연결됨 · 저장된 목소리 ${voiceProfiles.length}개`
                      : voiceboxStatus === "checking"
                        ? "연결 확인 중"
                        : "오프라인 · Voicebox 앱을 먼저 실행해주세요"}
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
                <div>
                  <strong>아바타 사진</strong>
                  <span>정면 얼굴이 잘 보이는 JPG/PNG, 밝은 조명, 모자/마스크 없는 사진을 권장합니다.</span>
                </div>
                <div>
                  <strong>목소리 샘플</strong>
                  <span>잡음이 적은 WAV/MP3와 그 음성에서 실제로 말한 문장을 같이 넣어주세요.</span>
                </div>
                <div>
                  <strong>전체 녹음</strong>
                  <span>대본 전체를 이미 읽은 음성이 있으면 Voicebox 없이 바로 영상 생성에 사용합니다.</span>
                </div>
                <label className="referenceScript">
                  <strong>샘플 대본</strong>
                  <textarea
                    value={voiceReferenceText}
                    onChange={(event) => setVoiceReferenceText(event.target.value)}
                    placeholder="목소리 샘플에서 실제로 말한 문장을 그대로 입력하세요."
                  />
                </label>
              </div>
            )}
          </div>

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
              <strong>{isExerciseMode ? "AI 운동 시연 생성" : "아바타 릴스 생성"}</strong>
            </span>
            <span className="modelBars" />
          </button>

          <div className="settingPanel" aria-label="영상 출력 설정">
            {isExerciseMode ? (
              <div className="settingGroup">
                <span>영상 길이</span>
                <div className="segmentedControl">
                  {(["15s", "20s", "30s"] as DurationOption[]).map((option) => (
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
                <StatusRow label="포즈 가이드" value={poseGuideName || "대기 중"} done={Boolean(poseGuideName)} />
                <StatusRow label="레퍼런스" value={referenceNames.length ? `${referenceNames.length}장 업로드` : "대기 중"} done={referenceNames.length > 0} />
                <StatusRow label="엔진" value="Seedance 2.0 mock" done />
              </>
            ) : (
              <>
                <StatusRow label="아바타" value={avatar.id ? "준비됨" : avatar.error || "대기 중"} done={Boolean(avatar.id)} />
                <StatusRow
                  label="목소리"
                  value={narrationAudioName || (activeVoiceId ? selectedVoiceProfile?.name || "준비됨" : voice.error || "대기 중")}
                  done={Boolean(activeVoiceId || narrationAudioName)}
                />
              </>
            )}
            <StatusRow label="렌더링" value={videoStatus} done={videoStatus === "completed"} />
          </div>

          <button className="generateButton" onClick={generateVideo} type="button">
            {isExerciseMode ? "동작 영상 만들기" : "아바타 릴스 만들기"}
            {videoStatus === "processing" && <span>{progress}%</span>}
          </button>
        </aside>

        <section className="canvasArea" aria-label="영상 생성 작업 영역">
          <div className="canvasToolbar">
            <button type="button">작업 기록</button>
            <button className="active" type="button">사용 방법</button>
          </div>

          <div className="heroCanvas">
            <div className="heroContent">
              <h1>{isExerciseMode ? "운동 동작을 AI 시연 영상으로 만드세요" : "아바타가 말하는 릴스를 만드세요"}</h1>
              <p>
                {isExerciseMode
                  ? "아바타 이미지와 포즈 가이드를 만들고, 그대로 Seedance 기반 동작 영상까지 이어서 생성합니다."
                  : "얼굴 사진과 목소리 샘플만 넣으면 촬영 없이 회원 교육용 릴스와 홍보용 숏폼을 반복 제작합니다."}
              </p>
            </div>

            <div className="flowOverview" aria-label="선택한 포맷의 제작 단계">
              {(isExerciseMode
                ? ["아바타 이미지", "포즈 가이드", "동작 프롬프트", "Seedance 영상"]
                : ["얼굴 사진", "목소리 샘플", "릴스 대본", "자동 자막 영상"]
              ).map((item, index) => (
                <div className="flowPill" key={item}>
                  <span>{index + 1}</span>
                  <strong>{item}</strong>
                </div>
              ))}
            </div>

            <div className="workflowStage">
              <div className="previewCard">
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
                    <div className="avatarFigure">
                      <div className="avatarHead" />
                      <div className="avatarBody" />
                    </div>
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
                  <span>{isExerciseMode ? "I2V" : "Voice"}</span>
                </div>
                <h2>{isExerciseMode ? "동작 리소스 기반 영상 생성" : "아바타 토킹 릴스 생성"}</h2>
                <p>
                  {isExerciseMode
                    ? "운동 가이드 시트와 체형 레퍼런스를 참고해 실제 사람이 움직이는 시연 영상을 만듭니다."
                    : "아바타와 목소리로 수업 팁, 회원 안내, 홍보 멘트를 세로 릴스로 만듭니다."}
                </p>
              </div>

              <div className="dashedSlot">
                <span>프롬프트 복사</span>
              </div>

              <div className="stepCard">
                {isExerciseMode ? (
                  <div className="presetCarousel">
                    <span />
                    <span className="selected" />
                    <span />
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
                    ? "포즈 가이드 1장과 모델 레퍼런스 최대 9장을 영상 입력값으로 사용합니다."
                    : "말할 내용만 적으면 자동 자막, 화면 비율, 릴스 길이를 맞춰 렌더링합니다."}
                </p>
              </div>

              <div className="stepCard output">
                <div className="outputFrame">
                  {isExerciseMode ? (
                    <div className="miniAvatar formatDMini" />
                  ) : (
                    <div className="outputReelPreview">
                      <img
                        className="outputExamplePhoto"
                        src="/images/pilates-talking-avatar.png"
                        alt="완성된 아바타 릴스 예시"
                      />
                      <div className="outputCaption">
                        <span>아바타 릴스 완성</span>
                        <strong>오늘의 필라테스 팁</strong>
                      </div>
                    </div>
                  )}
                </div>
                <h3>{isExerciseMode ? "운동 시연 완성" : "아바타 릴스 완성"}</h3>
                <p>
                  {isExerciseMode
                    ? "15~20초 단위 시연 영상을 만들고, 필요하면 60초 릴스로 연결합니다."
                    : "완성된 MP4를 인스타 릴스, 유튜브 쇼츠, 틱톡 규격으로 내려받습니다."}
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
