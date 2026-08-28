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

/**
 * 위의 "keeps energy within 0..1"은 **0도 통과시킨다.** 그래서 클램프가 바닥으로
 * 무너져도(항상 0) 아무것도 잡지 못한다 — energy는 캐릭터 입 모양과 흔들림의 세기라,
 * 항상 0이면 렌더는 성공하고 캐릭터만 얼어붙는다.
 *
 * 그래서 범위가 아니라 **계산된 값 자체**를 박는다. energy는 초당 단어수(density)를
 * 5로 나눈 값이고, 0..1 밖으로 나가면 그 경계로 자른다.
 */
describe('analyzeVoiceState — energy 클램프', () => {
  /**
   * 일부러 0에서 시작하지 않는다. start가 0이면 `end - start`와 `end + start`가 같은 값이
   * 되어, 길이를 재는 식이 통째로 바뀌어도 검사가 아무것도 눈치채지 못한다.
   */
  const START = 4;
  const segment = (wordCount: number, durationSec: number): SubtitleJSON => [{
    id: 0, text: 'x', start: START, end: START + durationSec,
    words: Array.from({ length: wordCount }, (_, i) => ({
      word: `w${i}`,
      start: START + (i * durationSec) / Math.max(1, wordCount),
      end: START + durationSec,
    })),
  }];
  const midpoint = (durationSec: number) => START + durationSec / 2;

  /** 2단어 / 2초 = 초당 1단어 → 1/5. 그대로 통과한다 — 0으로도 1로도 무너지지 않는다. */
  it('경계 안의 값은 손대지 않고 그대로 통과시킨다', () => {
    expect(analyzeVoiceState(segment(2, 2), midpoint(2)).energy).toBeCloseTo(0.2, 10);
  });

  /** 5단어 / 2초 = 초당 2.5단어 → 0.5. 한 점만으로는 상수 반환과 구분되지 않는다. */
  it('빠를수록 커진다 — 두 번째 안쪽 지점', () => {
    expect(analyzeVoiceState(segment(5, 2), midpoint(2)).energy).toBeCloseTo(0.5, 10);
    expect(analyzeVoiceState(segment(5, 2), midpoint(2)).energy)
      .toBeGreaterThan(analyzeVoiceState(segment(2, 2), midpoint(2)).energy);
  });

  /** 20단어 / 2초 = 초당 10단어 → 2. 천장에서 정확히 1로 잘린다(1을 넘지도, 넘겨서 남지도 않는다). */
  it('천장을 넘는 값은 정확히 1로 자른다', () => {
    expect(analyzeVoiceState(segment(20, 2), midpoint(2)).energy).toBe(1);
  });

  /** 천장 바로 아래는 잘리지 않는다 — 자르는 위치가 1이라는 증거. */
  it('천장 바로 아래는 자르지 않는다', () => {
    expect(analyzeVoiceState(segment(9, 2), midpoint(2)).energy).toBeCloseTo(0.9, 10);
  });

  /**
   * 길이 0짜리 세그먼트(whisper가 start === end로 뱉는 경우)는 초당 단어수를 잴 수 없다.
   * 나눗셈을 막지 않으면 Infinity가 되어 **가장 조용한 구간이 최대 energy로 나온다.**
   */
  it('길이 0인 세그먼트는 최대치가 아니라 0이다', () => {
    expect(analyzeVoiceState(segment(2, 0), midpoint(0)).energy).toBe(0);
  });

  /** 바닥은 0이다. 말하는 중인 것과 energy가 0인 것은 별개다. */
  it('바닥은 0이고, 그래도 말하는 중으로 본다', () => {
    const s = analyzeVoiceState(segment(0, 2), midpoint(2));
    expect(s.energy).toBe(0);
    expect(s.isSpeaking).toBe(true);
  });
});
