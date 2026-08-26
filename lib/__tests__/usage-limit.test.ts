import { describe, it, expect } from 'vitest';
import { canRender, MONTHLY_RENDER_LIMIT } from '../projects';
import type { StudentAccount } from '../auth';

const student = (count: number): StudentAccount => ({
  id: 'u1', name: '수강생1', codeHash: 'x',
  monthlyRenderCount: count, createdAt: '2026-08-26T00:00:00Z',
});

describe('canRender', () => {
  it('allows a student under the limit', () => {
    expect(canRender(student(0))).toBe(true);
    expect(canRender(student(MONTHLY_RENDER_LIMIT - 1))).toBe(true);
  });

  it('blocks a student at the limit', () => {
    expect(canRender(student(MONTHLY_RENDER_LIMIT))).toBe(false);
  });

  it('blocks a student past the limit', () => {
    expect(canRender(student(MONTHLY_RENDER_LIMIT + 5))).toBe(false);
  });
});
