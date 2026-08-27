import { describe, it, expect } from 'vitest';
import { characterEntry } from '../components/CharacterImage';

describe('characterEntry', () => {
  it('starts invisible and below its resting place', () => {
    const at0 = characterEntry(0, 30);
    expect(at0.opacity).toBe(0);
    expect(at0.translateY).toBeGreaterThan(0);
  });

  it('settles fully visible at rest', () => {
    const settled = characterEntry(30, 30);
    expect(settled.opacity).toBe(1);
    expect(settled.translateY).toBe(0);
  });

  it('never overshoots opacity', () => {
    for (const f of [0, 5, 10, 20, 45, 200]) {
      const v = characterEntry(f, 30);
      expect(v.opacity).toBeGreaterThanOrEqual(0);
      expect(v.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('does not throw for a negative frame', () => {
    expect(() => characterEntry(-5, 30)).not.toThrow();
  });

  // fps가 낮아도 보간 구간이 무너지면 안 된다 — 계획 1에서 같은 실수를 한 적이 있다.
  it('does not throw for a very low fps', () => {
    expect(() => characterEntry(0, 1)).not.toThrow();
  });
});
