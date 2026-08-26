import { describe, it, expect } from 'vitest';
import { analyzeVoiceState } from '../utils/voiceAnalysis';
import type { SubtitleJSON } from '../types';

const subs: SubtitleJSON = [{
  id: 0, text: '안녕하세요 반갑습니다', start: 0, end: 2,
  words: [
    { word: '안녕하세요', start: 0, end: 1 },
    { word: '반갑습니다', start: 1, end: 2 },
  ],
}];

describe('analyzeVoiceState', () => {
  it('reports silence outside every segment', () => {
    const s = analyzeVoiceState(subs, 5);
    expect(s.isSpeaking).toBe(false);
    expect(s.energy).toBe(0);
  });

  it('reports speaking inside a segment', () => {
    expect(analyzeVoiceState(subs, 0.5).isSpeaking).toBe(true);
  });

  it('tracks the current word index', () => {
    expect(analyzeVoiceState(subs, 0.5).currentWordIndex).toBe(0);
    expect(analyzeVoiceState(subs, 1.5).currentWordIndex).toBe(1);
  });

  it('keeps energy within 0..1', () => {
    const s = analyzeVoiceState(subs, 1.5);
    expect(s.energy).toBeGreaterThanOrEqual(0);
    expect(s.energy).toBeLessThanOrEqual(1);
  });

  it('handles empty subtitles', () => {
    expect(analyzeVoiceState([], 1).isSpeaking).toBe(false);
  });
});
