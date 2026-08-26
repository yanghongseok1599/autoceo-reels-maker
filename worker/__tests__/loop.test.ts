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
});
