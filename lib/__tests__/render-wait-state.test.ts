import { describe, it, expect } from 'vitest';
import {
  WAITING_NOTE,
  WAITING_STAGE,
  WORKER_DOWN_NOTE,
  WORKER_DOWN_STAGE,
  progressStageLabel,
  renderProgressView,
} from '@/lib/render-wait-state';

/** 기본값을 그대로 쓰지 않는다 — 검사마다 어느 값이 답을 정했는지 분명해야 한다. */
function view(over: Partial<Parameters<typeof renderProgressView>[0]> = {}) {
  return renderProgressView({
    jobStatus: 'rendering',
    uiStatus: 'processing',
    progress: 40,
    workerAlive: true,
    ...over,
  });
}

describe('progressStageLabel', () => {
  it('names the stage the progress actually corresponds to', () => {
    expect(progressStageLabel(0, 'processing')).toBe('음성 합성 중');
    expect(progressStageLabel(24, 'processing')).toBe('음성 합성 중');
    expect(progressStageLabel(25, 'processing')).toBe('아바타 렌더링 중');
    expect(progressStageLabel(54, 'processing')).toBe('아바타 렌더링 중');
    expect(progressStageLabel(55, 'processing')).toBe('자막·타이밍 합성 중');
    expect(progressStageLabel(84, 'processing')).toBe('자막·타이밍 합성 중');
    expect(progressStageLabel(85, 'processing')).toBe('마무리 중');
    expect(progressStageLabel(100, 'processing')).toBe('마무리 중');
  });

  /** 완료는 진행률과 무관하다. 0을 줘도 "음성 합성 중"으로 새면 안 된다. */
  it('says 완성 when the job is done, whatever the progress reads', () => {
    expect(progressStageLabel(0, 'completed')).toBe('완성');
    expect(progressStageLabel(100, 'completed')).toBe('완성');
  });
});

describe('renderProgressView — 큐에 있는 잡', () => {
  /**
   * 이 파일이 존재하는 이유. 큐에 들어간 잡의 진행률은 0이고, 예전에는 그 0이 곧바로
   * "음성 합성 중"이 됐다 — 아무도 집어가지 않은 잡을 작업 중이라고 말한 것이다.
   */
  it('does not claim work is happening on a job nothing has claimed', () => {
    const result = view({ jobStatus: 'queued', progress: 0 });
    expect(result.stage).not.toBe('음성 합성 중');
    expect(result.stage).toBe(WAITING_STAGE);
  });

  /**
   * 문구를 **글자 그대로** 고정한다. 상수끼리만 비교하면 상수가 빈 문자열이 되어도
   * 양쪽이 함께 비어 검사가 통과한다 — 수강생이 읽는 것이 이 기능의 전부인데
   * 그걸 아무도 지키지 않게 된다.
   */
  it('says the job is waiting its turn while the worker is alive', () => {
    expect(view({ jobStatus: 'queued', workerAlive: true })).toEqual({
      stage: '차례를 기다리는 중',
      note: '아직 렌더링이 시작되지 않았습니다. 차례가 되면 자동으로 시작되니 이 화면을 열어두세요.',
      alert: false,
    });
  });

  it('says the render server is not answering when the worker has not been seen', () => {
    expect(view({ jobStatus: 'queued', workerAlive: false })).toEqual({
      stage: '렌더 서버 응답 없음',
      note: '렌더 서버가 응답하지 않아 아직 시작하지 못했습니다. 만든 내용은 저장되어 있으니 다시 만들지 않아도 됩니다. 운영자에게 문의해주세요.',
      alert: true,
    });
  });

  /** 첫 폴링 응답이 오기 전(`''`)도 큐와 같은 대접이다. */
  it('treats a job status it has not heard yet as waiting', () => {
    expect(view({ jobStatus: '', workerAlive: true }).stage).toBe(WAITING_STAGE);
    expect(view({ jobStatus: '', workerAlive: false }).stage).toBe(WORKER_DOWN_STAGE);
  });

  /** 수강생이 스스로 할 수 있는 일이 없는 상태이므로, 연락할 곳을 반드시 말한다. */
  it('tells the student to contact the operator rather than to retry', () => {
    expect(WORKER_DOWN_NOTE).toContain('운영자에게 문의');
    expect(WORKER_DOWN_NOTE).not.toContain('다시 시도');
  });
});

describe('renderProgressView — 워커가 집어간 잡', () => {
  /**
   * 워커가 붙잡고 있으면 진행률 문구가 사실이다. 여기서 `workerAlive: false`를 줘도
   * 결과가 같아야 한다 — 그래야 위 갈래가 **큐 여부**로 갈린다는 것이 증명된다.
   */
  it('uses the progress stage labels once a worker holds the job', () => {
    expect(view({ jobStatus: 'claimed', progress: 0, workerAlive: false })).toEqual({
      stage: '음성 합성 중',
      note: '',
      alert: false,
    });
    expect(view({ jobStatus: 'rendering', progress: 60 }).stage).toBe('자막·타이밍 합성 중');
  });

  it('keeps the completed label off the queued branch', () => {
    expect(view({ jobStatus: 'completed', uiStatus: 'completed', progress: 100 }).stage).toBe('완성');
  });
});
