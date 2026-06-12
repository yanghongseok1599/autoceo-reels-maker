export type Language = "ko" | "en" | "ja" | "zh";

export type VoiceEngine =
  | "qwen"
  | "qwen_custom_voice"
  | "luxtts"
  | "chatterbox"
  | "chatterbox_turbo"
  | "tada"
  | "kokoro";

export type VoiceType = "cloned" | "preset" | "designed";

export interface VoiceProfile {
  id: string;
  name: string;
  description?: string | null;
  language: string;
  voiceType: VoiceType;
  presetEngine?: string | null;
  presetVoiceId?: string | null;
  designPrompt?: string | null;
  defaultEngine?: string | null;
  generationCount?: number;
  sampleCount?: number;
}

export interface PresetVoice {
  voiceId: string;
  name: string;
  gender?: string;
  language: string;
}

export interface VoiceModelStatus {
  modelName: string;
  displayName: string;
  downloaded: boolean;
  downloading: boolean;
  loaded: boolean;
  sizeMb?: number | null;
}

export interface VoiceboxGenerateRequest {
  text: string;
  profileId: string;
  language: Language;
  engine?: VoiceEngine;
  modelSize?: "1.7B" | "0.6B" | "1B" | "3B";
  seed?: number;
}

export interface VoiceboxGenerateResponse {
  generationId: string;
  status: "queued" | "running" | "done" | "error";
  audioUrl?: string;
  durationSec?: number;
  error?: string;
}
