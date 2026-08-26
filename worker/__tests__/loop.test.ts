import { describe, it, expect, vi } from 'vitest';
import { pollOnce } from '../index';

const job = { id: 'job1', projectId: 'p1', engine: 'remotion' as const };
const project = { id: 'p1', ownerId: 'u1', script: '무릎 통증 팁' };

describe('pollOnce', () => {
  it('does nothing when the queue is empty', async () => {
    const produce = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job: null, project: null }), produce, report: vi.fn(),
    });
    expect(result).toBe('idle');
    expect(produce).not.toHaveBeenCalled();
  });

  it('produces a reel and reports completion', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project }),
      produce: async () => ({ outputPath: '/out/job1.mp4', durationSec: 12 }),
      report,
    });
    expect(result).toBe('rendered');
    expect(report).toHaveBeenCalledWith('job1', {
      status: 'completed', progress: 100, resultUrl: '/out/job1.mp4',
    });
  });

  it('reports failure instead of throwing', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project }),
      produce: async () => { throw new Error('렌더 실패'); },
      report,
    });
    expect(result).toBe('failed');
    expect(report).toHaveBeenCalledWith('job1', { status: 'failed', error: '렌더 실패' });
  });

  it('fails the job when the project is missing', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project: null }), produce: vi.fn(), report,
    });
    expect(result).toBe('failed');
    expect(report).toHaveBeenCalledWith('job1', {
      status: 'failed', error: '프로젝트를 찾을 수 없습니다.',
    });
  });

  // 진행률 보고가 거부되면 워커가 죽으면 안 된다. void 만으로는 거부를 삼키지 못한다.
  //
  // report는 일부러 vi.fn()으로 감싸지 않는다 — vi.fn()(mockRejectedValue 포함)은
  // 호출 결과를 추적하려고 내부적으로 반환된 프라미스에 .then()을 붙이는데, 그게
  // Node 기준으로 "handled" 판정을 만들어 버려서 .catch()가 있든 없든 이 테스트가
  // 항상 통과해 버린다(직접 확인함: vi.fn 버전은 .catch() 유무와 무관하게 unhandled
  // 가 null). 순수 함수로 직접 거부해야 실제 방어 로직 유무를 구분해 낸다.
  it('swallows a progress report that rejects', async () => {
    const { makeProgressReporter } = await import('../index');
    const calls: Array<[string, Record<string, unknown>]> = [];
    const report = (id: string, patch: Record<string, unknown>) => {
      calls.push([id, patch]);
      return Promise.reject(new Error('network blip'));
    };
    const onProgress = makeProgressReporter(report)('job1');

    let unhandled: unknown = null;
    const onUnhandled = (reason: unknown) => { unhandled = reason; };
    process.on('unhandledRejection', onUnhandled);

    expect(() => onProgress(50)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toBeNull();
    expect(calls).toEqual([['job1', { status: 'rendering', progress: 50 }]]);
  });
});
