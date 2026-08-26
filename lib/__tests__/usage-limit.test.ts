import { describe, it, expect } from 'vitest';
import {
  canRender, chargeRender, currentPeriod, renderCountInPeriod, MONTHLY_RENDER_LIMIT,
} from '../projects';
import type { StudentAccount } from '../auth';

const student = (count: number, renderPeriod?: string): StudentAccount => ({
  id: 'u1', name: '수강생1', codeHash: 'x',
  monthlyRenderCount: count, renderPeriod, createdAt: '2026-08-26T00:00:00Z',
});

const AUGUST = new Date('2026-08-26T00:00:00Z');
const SEPTEMBER = new Date('2026-09-01T00:00:00Z');

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

describe('currentPeriod', () => {
  it('is the UTC year and month', () => {
    expect(currentPeriod(AUGUST)).toBe('2026-08');
    expect(currentPeriod(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01');
  });
});

describe('renderCountInPeriod', () => {
  it('counts renders made in the current month', () => {
    expect(renderCountInPeriod(student(7, '2026-08'), AUGUST)).toBe(7);
  });

  it('ignores renders made in an earlier month', () => {
    expect(renderCountInPeriod(student(30, '2026-08'), SEPTEMBER)).toBe(0);
  });

  // 배포 이전 기록에는 기간이 없다. 전원에게 30편을 새로 주는 것보다 이번 달로 보는 편이 안전하다.
  it('treats a record with no period as belonging to this month', () => {
    expect(renderCountInPeriod(student(30, undefined), AUGUST)).toBe(30);
  });
});

describe('canRender across a month boundary', () => {
  it('unblocks a student who hit the limit last month', () => {
    const maxed = student(MONTHLY_RENDER_LIMIT, '2026-08');
    expect(canRender(maxed, AUGUST)).toBe(false);
    expect(canRender(maxed, SEPTEMBER)).toBe(true);
  });
});

describe('chargeRender', () => {
  it('increments within the same month', () => {
    const next = chargeRender(student(3, '2026-08'), AUGUST);
    expect(next.monthlyRenderCount).toBe(4);
    expect(next.renderPeriod).toBe('2026-08');
  });

  it('restarts the count when the month rolls over', () => {
    const next = chargeRender(student(MONTHLY_RENDER_LIMIT, '2026-08'), SEPTEMBER);
    expect(next.monthlyRenderCount).toBe(1);
    expect(next.renderPeriod).toBe('2026-09');
  });

  it('stamps the period onto a record that had none', () => {
    expect(chargeRender(student(0, undefined), AUGUST).renderPeriod).toBe('2026-08');
  });

  it('does not mutate the stored record', () => {
    const original = student(3, '2026-08');
    chargeRender(original, SEPTEMBER);
    expect(original.monthlyRenderCount).toBe(3);
    expect(original.renderPeriod).toBe('2026-08');
  });
});
