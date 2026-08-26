import { describe, it, expect } from 'vitest';
import { getEngine } from '../engines/remotion';

describe('engine registry', () => {
  it('returns the remotion engine', () => {
    expect(getEngine('remotion').id).toBe('remotion');
  });

  it('declares vertical-only, compute-cost capabilities', () => {
    const caps = getEngine('remotion').capabilities;
    expect(caps.aspectRatios).toEqual(['9:16']);
    expect(caps.costModel).toBe('compute');
    expect(caps.lipSync).toBe(false);
    expect(caps.requiresUserKey).toBe(false);
  });

  it('throws for an engine that is not implemented yet', () => {
    expect(() => getEngine('higgsfield')).toThrow(/구현되지 않은 엔진/);
  });
});
