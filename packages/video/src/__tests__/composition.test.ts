import { describe, it, expect } from 'vitest';
import { REEL_WIDTH, REEL_HEIGHT, REEL_FPS, calculateDurationInFrames } from '../Root';

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
});
