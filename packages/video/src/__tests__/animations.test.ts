import { describe, it, expect } from 'vitest';
import { getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

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
