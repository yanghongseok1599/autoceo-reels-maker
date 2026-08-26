import { describe, it, expect } from 'vitest';
import {
  getEntryExitOpacity, getExitBlur, getEntryExitScale, getStaggerTiming,
} from '../utils/animations';

describe('getEntryExitOpacity', () => {
  it('fades in over the first 10 frames', () => {
    expect(getEntryExitOpacity(0, 90)).toBe(0);
    expect(getEntryExitOpacity(10, 90)).toBe(1);
  });

  it('stays opaque in the middle', () => {
    expect(getEntryExitOpacity(45, 90)).toBe(1);
  });

  it('fades out over the last 10 frames', () => {
    expect(getEntryExitOpacity(90, 90)).toBe(0);
  });
});

describe('getExitBlur', () => {
  it('is zero until the exit window', () => {
    expect(getExitBlur(45, 90)).toBe(0);
  });

  it('grows at the end', () => {
    expect(getExitBlur(90, 90)).toBeGreaterThan(0);
  });
});

// Remotion의 interpolate는 입력 범위가 엄격히 증가해야 한다. 짧은 씬에서 범위가 무너지면
// 렌더 도중 예외가 난다 — 긴 씬 테스트만으로는 절대 잡히지 않는 종류의 결함이다.
describe('short scenes do not break the interpolate ranges', () => {
  const shortDurations = [1, 2, 3, 5, 15, 21];

  it('never throws for any short duration', () => {
    for (const dur of shortDurations) {
      for (const frame of [0, Math.floor(dur / 2), dur]) {
        expect(() => getEntryExitOpacity(frame, dur)).not.toThrow();
        expect(() => getExitBlur(frame, dur)).not.toThrow();
        expect(() => getEntryExitScale(frame, dur, 30, 0.8, 1.08)).not.toThrow();
      }
    }
  });

  it('keeps opacity inside 0..1 for short scenes', () => {
    for (const dur of shortDurations) {
      const value = getEntryExitOpacity(Math.floor(dur / 2), dur);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('skips the fade entirely when the scene is too short for one', () => {
    expect(getEntryExitOpacity(0, 2)).toBe(1);
    expect(getExitBlur(2, 2)).toBe(0);
  });
});

// 순차 등장 간격을 상수로 고정하면, 씬 길이를 정하는 쪽(파이프라인/whisper 구간)이 이
// 계약을 모른 채 짧은 씬을 만들었을 때 마지막 항목이 퇴장 페이드 뒤에야 또렷해진다.
describe('getStaggerTiming', () => {
  it('keeps the full stagger when the scene has room', () => {
    expect(getStaggerTiming(90, 4)).toMatchObject({ stagger: 8, reveal: 10 });
  });

  it('shrinks the stagger for a short scene with many items', () => {
    // 45프레임(1.5초) 6항목. 고정 8프레임이면 마지막 항목이 5*8+10 = 48프레임에야
    // 또렷해지는데, 퇴장 페이드는 35프레임에 시작한다.
    const { stagger, reveal, exitStart } = getStaggerTiming(45, 6);
    expect(exitStart).toBe(35);
    expect(stagger).toBeLessThan(8);
    expect(5 * stagger + reveal).toBeLessThanOrEqual(exitStart);
  });

  it('lands every item before the exit fade, for any duration and item count', () => {
    for (const duration of [1, 2, 3, 5, 15, 30, 45, 60, 90]) {
      for (const itemCount of [1, 2, 3, 4, 6, 10]) {
        const { stagger, reveal, exitStart } = getStaggerTiming(duration, itemCount);
        const lastFullyVisible = (itemCount - 1) * stagger + reveal;
        expect(lastFullyVisible).toBeLessThanOrEqual(exitStart);
      }
    }
  });

  it('never yields a non-increasing interpolate range', () => {
    for (const duration of [0, 1, 2, 3, 90]) {
      const { stagger, reveal } = getStaggerTiming(duration, 6);
      expect(reveal).toBeGreaterThan(0);
      expect(stagger).toBeGreaterThanOrEqual(0);
    }
  });
});
