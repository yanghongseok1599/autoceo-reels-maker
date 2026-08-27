import { describe, it, expect, beforeEach } from 'vitest';
import { getLearningInsights, RECOMMENDATION_MIN_SAMPLES } from '../learning-store';
import { store } from '../store';

const record = (i: number, feedback?: 'good' | 'bad') => ({
  id: `l${i}`, jobId: `j${i}`, format: 'format_a' as const,
  createdAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z',
  status: 'completed' as const, script: '대본', referenceCount: 0, referenceNames: [],
  ...(feedback ? { feedback } : {}),
});

async function seed(n: number, good: number) {
  await store.write('learning-records',
    Array.from({ length: n }, (_, i) => record(i, i < good ? 'good' : undefined)));
}

describe('getLearningInsights', () => {
  it('withholds a recommendation below the sample threshold', async () => {
    await seed(3, 1);
    const insights = await getLearningInsights('format_a');
    expect(insights.recommendation).toContain('표본');
  });

  it('still reports observed signals below the threshold', async () => {
    await seed(3, 1);
    const insights = await getLearningInsights('format_a');
    expect(insights.signals.length).toBeGreaterThan(0);
    expect(insights.total).toBe(3);
  });

  it('gives a recommendation once the threshold is met', async () => {
    await seed(RECOMMENDATION_MIN_SAMPLES, RECOMMENDATION_MIN_SAMPLES);
    const insights = await getLearningInsights('format_a');
    expect(insights.recommendation).not.toContain('표본');
  });

  it('counts rated records, not merely stored ones', async () => {
    await seed(RECOMMENDATION_MIN_SAMPLES, 1);
    const insights = await getLearningInsights('format_a');
    expect(insights.recommendation).toContain('표본');
  });

  // format_d는 별도 분기에서 자기 recommendation을 반환한다. 한쪽만 고치면 D탭이 n=1로 처방한다.
  it('applies the threshold to the format_d branch too', async () => {
    await store.write('learning-records', [{ ...record(0, 'good'), format: 'format_d' as const }]);
    const insights = await getLearningInsights('format_d');
    expect(insights.recommendation).toContain('표본');
  });

  it('gives a format_d recommendation once the threshold is met', async () => {
    await store.write('learning-records', Array.from(
      { length: RECOMMENDATION_MIN_SAMPLES },
      (_, i) => ({ ...record(i, 'good'), format: 'format_d' as const, referenceCount: 2 }),
    ));
    const insights = await getLearningInsights('format_d');
    expect(insights.recommendation).not.toContain('표본');
  });
});

/**
 * 예전에는 이 모듈이 `.local-data`에 직접 파일을 읽고 썼다. Vercel에서는 그 경로가
 * 읽기 전용이라 기록이 조용히 사라진다 — `fish-voices`가 겪었던 것과 같은 고장이다.
 * `store` 인터페이스를 타야 배포 저장소로 갈아끼울 수 있고, 테스트가 데이터를 심을 수 있다.
 */
describe('storage backend', () => {
  beforeEach(async () => {
    await store.write('learning-records', []);
  });

  it('reads what the store holds under the shared key', async () => {
    await seed(3, 1);
    expect((await getLearningInsights('format_a')).total).toBe(3);
  });

  it('records written by createLearningRecord come back through the store', async () => {
    const { createLearningRecord } = await import('../learning-store');
    await createLearningRecord({ jobId: 'j-new', format: 'format_a', script: '새 대본' });
    const held = await store.read<unknown[]>('learning-records', []);
    expect(held).toHaveLength(1);
    expect((await getLearningInsights('format_a')).total).toBe(1);
  });
});
