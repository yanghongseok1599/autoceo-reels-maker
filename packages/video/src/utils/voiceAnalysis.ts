import type { SubtitleJSON } from '../types';

export interface VoiceState {
  isSpeaking: boolean;
  energy: number;
  currentWordIndex: number;
}

const SILENT: VoiceState = { isSpeaking: false, energy: 0, currentWordIndex: 0 };

export function analyzeVoiceState(subtitles: SubtitleJSON, currentTime: number): VoiceState {
  if (!subtitles?.length) return SILENT;

  const seg = subtitles.find((s) => currentTime >= s.start && currentTime <= s.end);
  if (!seg) return SILENT;

  const words = seg.words;
  let currentWordIndex = 0;
  for (let i = 0; i < words.length; i++) {
    if (currentTime >= words[i].start) currentWordIndex = i;
  }

  const segDuration = seg.end - seg.start;
  const density = segDuration > 0 ? words.length / segDuration : 0;
  const energy = Math.min(1, Math.max(0, density / 5));

  return { isSpeaking: true, energy, currentWordIndex };
}
