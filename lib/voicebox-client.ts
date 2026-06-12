import { env } from "@/lib/env";
import type {
  PresetVoice,
  VoiceEngine,
  VoiceModelStatus,
  VoiceProfile,
  VoiceboxGenerateRequest,
  VoiceboxGenerateResponse,
} from "@/lib/voicebox-types";

export const KOREAN_ENGINE: VoiceEngine = "qwen_custom_voice";
export const KOREAN_MODEL_SIZE = "0.6B" as const;

function jsonHeaders(extra?: Record<string, string>) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    ...extra,
  };
  if (env.voiceboxApiKey) {
    headers.Authorization = `Bearer ${env.voiceboxApiKey}`;
  }
  return headers;
}

async function vbFetch(path: string, init?: RequestInit, timeoutMs = 10000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(env.voiceboxBaseUrl + path, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function mapProfile(profile: Record<string, unknown>): VoiceProfile {
  return {
    id: String(profile.id),
    name: String(profile.name ?? ""),
    description: (profile.description as string) ?? null,
    language: String(profile.language ?? "ko"),
    voiceType: (profile.voice_type as VoiceProfile["voiceType"]) ?? "preset",
    presetEngine: (profile.preset_engine as string) ?? null,
    presetVoiceId: (profile.preset_voice_id as string) ?? null,
    designPrompt: (profile.design_prompt as string) ?? null,
    defaultEngine: (profile.default_engine as string) ?? null,
    generationCount: (profile.generation_count as number) ?? 0,
    sampleCount: (profile.sample_count as number) ?? 0,
  };
}

export async function checkHealth(): Promise<{
  reachable: boolean;
  modelLoaded?: boolean;
  gpu?: string;
  error?: string;
}> {
  try {
    const response = await vbFetch("/health");
    if (!response.ok) {
      return { reachable: false, error: `HTTP ${response.status}` };
    }
    const data = (await response.json()) as {
      model_loaded?: boolean;
      gpu_type?: string | null;
      backend_variant?: string;
    };

    return {
      reachable: true,
      modelLoaded: data.model_loaded,
      gpu: data.gpu_type ?? data.backend_variant ?? "cpu",
    };
  } catch (error) {
    return {
      reachable: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function listProfiles(): Promise<VoiceProfile[]> {
  try {
    const response = await vbFetch("/profiles");
    if (!response.ok) return [];
    const data = (await response.json()) as Record<string, unknown>[];
    return Array.isArray(data) ? data.map(mapProfile) : [];
  } catch {
    return [];
  }
}

export async function getProfile(id: string): Promise<VoiceProfile | null> {
  try {
    const response = await vbFetch(`/profiles/${id}`);
    if (!response.ok) return null;
    return mapProfile((await response.json()) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export async function listPresetVoices(engine: string): Promise<PresetVoice[]> {
  try {
    const response = await vbFetch(`/profiles/presets/${engine}`);
    if (!response.ok) return [];
    const data = (await response.json()) as {
      voices?: Array<{ voice_id: string; name: string; gender?: string; language: string }>;
    };

    return (data.voices ?? []).map((voice) => ({
      voiceId: voice.voice_id,
      name: voice.name,
      gender: voice.gender,
      language: voice.language,
    }));
  } catch {
    return [];
  }
}

export async function listModels(): Promise<VoiceModelStatus[]> {
  try {
    const response = await vbFetch("/models/status");
    if (!response.ok) return [];
    const data = (await response.json()) as {
      models?: Array<{
        model_name: string;
        display_name: string;
        downloaded: boolean;
        downloading: boolean;
        loaded: boolean;
        size_mb?: number | null;
      }>;
    };

    return (data.models ?? []).map((model) => ({
      modelName: model.model_name,
      displayName: model.display_name,
      downloaded: model.downloaded,
      downloading: model.downloading,
      loaded: model.loaded,
      sizeMb: model.size_mb,
    }));
  } catch {
    return [];
  }
}

export async function createProfile(input: {
  name: string;
  language: string;
  voiceType: "preset" | "cloned" | "designed";
  presetEngine?: string;
  presetVoiceId?: string;
  designPrompt?: string;
  defaultEngine?: string;
  description?: string;
}): Promise<VoiceProfile> {
  const body: Record<string, unknown> = {
    name: input.name,
    language: input.language,
    voice_type: input.voiceType,
  };
  if (input.presetEngine) body.preset_engine = input.presetEngine;
  if (input.presetVoiceId) body.preset_voice_id = input.presetVoiceId;
  if (input.designPrompt) body.design_prompt = input.designPrompt;
  if (input.defaultEngine) body.default_engine = input.defaultEngine;
  if (input.description) body.description = input.description;

  const response = await vbFetch("/profiles", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`프로필 생성 실패 (HTTP ${response.status}): ${await response.text()}`);
  }

  return mapProfile((await response.json()) as Record<string, unknown>);
}

export async function addProfileSample(profileId: string, audio: Blob, filename: string, referenceText: string) {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("reference_text", referenceText);

  const response = await vbFetch(`/profiles/${profileId}/samples`, { method: "POST", body: form }, 120000);

  if (!response.ok) {
    throw new Error(`샘플 업로드 실패 (HTTP ${response.status}): ${await response.text()}`);
  }
}

function engineForProfile(profile: VoiceProfile): { engine: VoiceEngine; modelSize?: "0.6B" } {
  if (profile.voiceType === "cloned" || profile.voiceType === "designed") {
    return { engine: "chatterbox" };
  }

  return {
    engine: (profile.presetEngine as VoiceEngine) ?? KOREAN_ENGINE,
    modelSize: KOREAN_MODEL_SIZE,
  };
}

type GenerationState = {
  id: string;
  status: string;
  duration?: number | null;
  error?: string | null;
};

async function getGenerationSnapshot(id: string): Promise<GenerationState> {
  const response = await vbFetch(`/history/${id}`);
  if (!response.ok) {
    throw new Error(`history HTTP ${response.status}`);
  }
  return (await response.json()) as GenerationState;
}

export async function generateSpeech(
  request: VoiceboxGenerateRequest,
  options: { pollMs?: number; timeoutMs?: number } = {},
): Promise<VoiceboxGenerateResponse> {
  const pollMs = options.pollMs ?? 3000;
  const timeoutMs = options.timeoutMs ?? 9 * 60 * 1000;
  const profile = await getProfile(request.profileId);
  const picked = profile ? engineForProfile(profile) : { engine: KOREAN_ENGINE, modelSize: KOREAN_MODEL_SIZE };
  const engine = request.engine ?? picked.engine;
  let modelSize = request.modelSize ?? picked.modelSize;

  if (engine === "chatterbox" || engine === "chatterbox_turbo") {
    modelSize = undefined;
  }

  const body: Record<string, unknown> = {
    profile_id: request.profileId,
    text: request.text,
    language: request.language,
    engine,
  };
  if (modelSize) body.model_size = modelSize;
  if (typeof request.seed === "number") body.seed = request.seed;

  let state: GenerationState;
  try {
    const response = await vbFetch(
      "/generate",
      {
        method: "POST",
        headers: jsonHeaders(),
        body: JSON.stringify(body),
      },
      30000,
    );

    if (!response.ok) {
      return {
        generationId: "",
        status: "error",
        error: `Voicebox /generate HTTP ${response.status}: ${await response.text()}`,
      };
    }

    state = (await response.json()) as GenerationState;
  } catch (error) {
    return {
      generationId: "",
      status: "error",
      error: `Voicebox 연결 실패: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const generationId = state.id;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const status = (state.status || "").toLowerCase();
    if (status === "completed" || status === "done" || status === "ready") {
      return {
        generationId,
        status: "done",
        audioUrl: `${env.voiceboxBaseUrl}/audio/${generationId}`,
        durationSec: state.duration ?? undefined,
      };
    }

    if (status === "error" || status === "failed") {
      return {
        generationId,
        status: "error",
        error: state.error ?? "Voicebox 합성 실패",
      };
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));

    try {
      state = await getGenerationSnapshot(generationId);
    } catch {
      // 일시적인 조회 실패는 다음 폴링에서 회복될 수 있습니다.
    }
  }

  return {
    generationId,
    status: "error",
    error: `Voicebox 합성 시간 초과 (${Math.round(timeoutMs / 1000)}s)`,
  };
}
