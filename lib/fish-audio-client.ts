import { mkdir, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";
import { env } from "@/lib/env";
import { appPublicDir } from "@/lib/paths";
import { listFishVoices, upsertFishVoice, type FishVoiceProfile } from "@/lib/fish-voice-store";

type FishModelEntity = {
  _id: string;
  title?: string;
  state?: string;
  languages?: string[];
  samples?: unknown[];
};

type FishSpeechResult = {
  generationId: string;
  status: "done" | "error";
  audioUrl?: string;
  durationSec?: number;
  error?: string;
};

/** 호출 시점에 정한다 — 모듈 로드 시점에 고정하면 테스트가 PUBLIC_DIR로 갈아끼울 수 없다. */
function generatedAudioDir() {
  return path.join(appPublicDir(), "generated-audio");
}

function requireFishApiKey() {
  if (!env.fishApiKey) {
    throw new Error("Fish Audio API 키가 필요합니다. .env.local에 FISH_API_KEY를 설정해주세요.");
  }
}

function fishHeaders(extra?: Record<string, string>) {
  requireFishApiKey();
  return {
    Authorization: `Bearer ${env.fishApiKey}`,
    ...extra,
  };
}

function mapToneToTemperature(instruct?: string) {
  if (!instruct) return 0.7;
  if (instruct.includes("차분") || instruct.includes("안정")) return 0.55;
  if (instruct.includes("활기") || instruct.includes("밝고")) return 0.82;
  return 0.7;
}

export function fishConfigured() {
  return Boolean(env.fishApiKey);
}

/**
 * 그 수강생이 클론한 목소리만 돌려준다.
 *
 * 예전에는 여기에 `env.fishReferenceId`를 "내목소리"라는 이름으로 끼워 넣었다.
 * 그건 **운영자의** 목소리이고, 모든 수강생의 피커 맨 위에 떠서 기본값으로 뽑혔다.
 * 수강생이 자기 목소리를 들으려고 돈을 내는 제품에서 이건 기능이 아니라 고장이다.
 */
export async function listFishProfiles(ownerId: string): Promise<FishVoiceProfile[]> {
  return listFishVoices(ownerId);
}

export async function createFishVoice(input: {
  ownerId: string;
  name: string;
  language: string;
  audio: Blob;
  filename: string;
  referenceText: string;
}): Promise<FishVoiceProfile> {
  const form = new FormData();
  form.append("visibility", "private");
  form.append("type", "tts");
  form.append("title", input.name);
  form.append("description", "오토사장 아바타 릴스용 사용자 목소리");
  form.append("train_mode", "fast");
  form.append("voices", input.audio, input.filename);
  form.append("texts", input.referenceText);
  form.append("tags", "autoceo-reels");
  form.append("enhance_audio_quality", "true");
  form.append("generate_sample", "false");

  const response = await fetch(`${env.fishBaseUrl}/model`, {
    method: "POST",
    headers: fishHeaders(),
    body: form,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Fish Audio 목소리 등록 실패 (HTTP ${response.status}): ${await response.text()}`);
  }

  const data = (await response.json()) as FishModelEntity;
  const profile = {
    id: data._id,
    ownerId: input.ownerId,
    name: data.title || input.name,
    language: data.languages?.[0] || input.language,
    sampleCount: data.samples?.length || 1,
    createdAt: new Date().toISOString(),
  };

  return upsertFishVoice(profile);
}

export async function synthesizeFishSpeech(input: {
  text: string;
  referenceId: string;
  speakingSpeed?: number;
  instruct?: string;
}): Promise<FishSpeechResult> {
  try {
    if (!input.referenceId) {
      throw new Error("Fish Audio voice model ID가 없습니다. 목소리를 먼저 등록해주세요.");
    }

    const speed = input.speakingSpeed ? Math.min(1.35, Math.max(0.8, 0.8 + input.speakingSpeed * 0.1)) : 1;
    const response = await fetch(`${env.fishBaseUrl}/v1/tts`, {
      method: "POST",
      headers: fishHeaders({
        "Content-Type": "application/json",
        model: env.fishTtsModel,
      }),
      body: JSON.stringify({
        text: input.text,
        reference_id: input.referenceId,
        temperature: mapToneToTemperature(input.instruct),
        top_p: 0.7,
        prosody: {
          speed,
          volume: 0,
          normalize_loudness: true,
        },
        chunk_length: 300,
        normalize: true,
        format: "mp3",
        sample_rate: 44100,
        mp3_bitrate: 128,
        latency: "normal",
        max_new_tokens: 1024,
        repetition_penalty: 1.2,
        min_chunk_length: 50,
        condition_on_previous_chunks: true,
        early_stop_threshold: 1,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      return {
        generationId: "",
        status: "error",
        error: `Fish Audio TTS 실패 (HTTP ${response.status}): ${await response.text()}`,
      };
    }

    const generationId = crypto.randomUUID();
    const audio = Buffer.from(await response.arrayBuffer());
    await mkdir(generatedAudioDir(), { recursive: true });
    await writeFile(path.join(generatedAudioDir(), `${generationId}.mp3`), audio);

    return {
      generationId,
      status: "done",
      audioUrl: `/generated-audio/${generationId}.mp3`,
    };
  } catch (error) {
    return {
      generationId: "",
      status: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function getFishSpeechStatus(id: string) {
  try {
    await access(path.join(generatedAudioDir(), `${id}.mp3`));
    return {
      status: "completed",
      audioUrl: `/generated-audio/${id}.mp3`,
      error: "",
    };
  } catch {
    return {
      status: "error",
      audioUrl: "",
      error: "Fish Audio 생성 파일을 찾을 수 없습니다.",
    };
  }
}
