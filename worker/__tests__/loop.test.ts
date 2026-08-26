import { describe, it, expect, vi } from 'vitest';
import {
  pollOnce, missingWorkerEnv, artifactKeyFor, engineInputFor, REQUIRED_WORKER_ENV,
} from '../index';

const job = { id: 'job1', projectId: 'p1', engine: 'remotion' as const };
const project = {
  id: 'p1', ownerId: 'u1', script: '무릎 통증 팁', voiceReferenceId: 'voice_u1',
};
const publish = async () => 'https://cdn.example/renders/job1.mp4';

describe('pollOnce', () => {
  it('does nothing when the queue is empty', async () => {
    const produce = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job: null, project: null }), produce, publish, report: vi.fn(),
    });
    expect(result).toBe('idle');
    expect(produce).not.toHaveBeenCalled();
  });

  // 워커 디스크 경로를 그대로 보고하면 브라우저가 열 수 없다. 업로드가 돌려준 URL이어야 한다.
  it('reports the published url, not the local render path', async () => {
    const report = vi.fn();
    const published = vi.fn(async () => '/renders/job1.mp4');
    const result = await pollOnce({
      claim: async () => ({ job, project }),
      produce: async () => ({ outputPath: '/tmp/.local-data/renders/job1.mp4', durationSec: 12 }),
      publish: published,
      report,
    });
    expect(result).toBe('rendered');
    expect(published).toHaveBeenCalledWith(job, {
      outputPath: '/tmp/.local-data/renders/job1.mp4', durationSec: 12,
    });
    expect(report).toHaveBeenCalledWith('job1', {
      status: 'completed', progress: 100, resultUrl: '/renders/job1.mp4',
    });
  });

  it('fails the job when the upload fails instead of reporting a local path', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project }),
      produce: async () => ({ outputPath: '/tmp/job1.mp4', durationSec: 12 }),
      publish: async () => { throw new Error('업로드 실패'); },
      report,
    });
    expect(result).toBe('failed');
    expect(report).toHaveBeenCalledWith('job1', { status: 'failed', error: '업로드 실패' });
  });

  it('reports failure instead of throwing', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project }),
      produce: async () => { throw new Error('렌더 실패'); },
      publish,
      report,
    });
    expect(result).toBe('failed');
    expect(report).toHaveBeenCalledWith('job1', { status: 'failed', error: '렌더 실패' });
  });

  it('fails the job when the project is missing', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project: null }), produce: vi.fn(), publish, report,
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

describe('missingWorkerEnv', () => {
  const full = {
    WORKER_TOKEN: 't', APP_URL: 'http://localhost:3000',
    FISH_API_KEY: 'k', WHISPER_MODEL: '/models/ggml-base.bin',
  };

  it('passes when every required variable is set', () => {
    expect(missingWorkerEnv(full)).toEqual([]);
  });

  it('names every missing variable at once, not just the first', () => {
    expect(missingWorkerEnv({ APP_URL: 'http://localhost:3000' }))
      .toEqual(['WORKER_TOKEN', 'FISH_API_KEY', 'WHISPER_MODEL']);
  });

  it('treats a blank value as missing', () => {
    expect(missingWorkerEnv({ ...full, FISH_API_KEY: '   ' })).toEqual(['FISH_API_KEY']);
  });

  it('requires the whole pipeline, not just the worker half', () => {
    expect([...REQUIRED_WORKER_ENV]).toContain('WHISPER_MODEL');
    expect([...REQUIRED_WORKER_ENV]).toContain('FISH_API_KEY');
  });

  // 목소리는 잡을 따라 다닌다. 전역 값을 요구하면 그 값을 쓰고 싶어진다.
  it('does not require a global voice id — the voice travels with the project', () => {
    expect([...REQUIRED_WORKER_ENV]).not.toContain('FISH_REFERENCE_ID');
    expect(missingWorkerEnv({ ...full, FISH_REFERENCE_ID: undefined })).toEqual([]);
  });
});

describe('engineInputFor', () => {
  const OUT = '/tmp/renders/job1.mp4';

  /**
   * 이 테스트가 지키는 것: 학생은 자기 목소리를 들으려고 돈을 낸다.
   * 운영자 env 값이 설정돼 있어도 렌더는 프로젝트의 목소리로 가야 한다.
   */
  it('renders with the project voice even when an operator env voice is set', () => {
    const previous = process.env.FISH_REFERENCE_ID;
    process.env.FISH_REFERENCE_ID = 'operator-voice';
    try {
      expect(engineInputFor(project, OUT).voiceReferenceId).toBe('voice_u1');
    } finally {
      if (previous === undefined) delete process.env.FISH_REFERENCE_ID;
      else process.env.FISH_REFERENCE_ID = previous;
    }
  });

  // 상수를 박아 넣어도 위 테스트는 통과한다. 프로젝트마다 달라야 진짜 배선이다.
  it('gives each project its own voice', () => {
    const other = { ...project, id: 'p2', ownerId: 'u2', voiceReferenceId: 'voice_u2' };
    expect(engineInputFor(project, OUT).voiceReferenceId).toBe('voice_u1');
    expect(engineInputFor(other, OUT).voiceReferenceId).toBe('voice_u2');
  });

  it('passes the script, owner and output path through unchanged', () => {
    expect(engineInputFor(project, OUT)).toEqual({
      projectId: 'p1', ownerId: 'u1', script: '무릎 통증 팁',
      voiceReferenceId: 'voice_u1', outPath: OUT,
    });
  });
});

describe('artifactKeyFor', () => {
  it('scopes renders under a single prefix so both stores agree on the path', () => {
    expect(artifactKeyFor('job_abc')).toBe('renders/job_abc.mp4');
  });
});
