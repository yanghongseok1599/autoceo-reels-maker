import { describe, it, expect } from 'vitest';
import { REEL_WIDTH, REEL_HEIGHT, REEL_FPS, calculateDurationInFrames } from '../Root';
import { FALLBACK_PALETTE } from '../types';

describe('ReelVertical composition', () => {
  it('is 1080x1920 at 30fps', () => {
    expect(REEL_WIDTH).toBe(1080);
    expect(REEL_HEIGHT).toBe(1920);
    expect(REEL_FPS).toBe(30);
  });

  it('derives frame count from duration', () => {
    expect(calculateDurationInFrames(30)).toBe(900);
    expect(calculateDurationInFrames(15.5)).toBe(465);
  });

  it('never returns zero frames', () => {
    expect(calculateDurationInFrames(0)).toBe(1);
  });

  it('provides a fallback palette with hex colors for every key', () => {
    expect(Object.keys(FALLBACK_PALETTE).sort()).toEqual(['accent', 'ink', 'paper']);
    for (const value of Object.values(FALLBACK_PALETTE)) {
      expect(value).toMatch(/^#[0-9a-fA-F]{3,8}$/);
    }
  });
});
