/**
 * "만들기를 눌렀는데 아무 일도 안 일어난다"를 화면이 어떻게 말할지 정하는 곳.
 *
 * 예전에는 진행률 하나로만 말했다. 큐에 들어간 잡의 진행률은 0이고 0은 25보다 작으므로,
 * **아무도 집어가지 않은 잡이 "음성 합성 중"으로 표시됐다.** 워커(운영자 맥)가 꺼져 있으면
 * 그 문구는 몇 시간이고 그대로 남았다 — 돈을 낸 수강생이 화면을 믿고 기다린 시간만큼
 * 화면이 거짓말을 한 셈이다.
 *
 * 그래서 갈래를 셋으로 나눈다. 진행률이 아니라 **잡 상태와 워커 생존**으로 가른다.
 */

/** 진행률 구간별 문구. 워커가 실제로 붙잡고 있을 때만 이 말이 사실이다. */
export function progressStageLabel(value: number, status: string): string {
  if (status === 'completed') return '완성';
  if (value < 25) return '음성 합성 중';
  if (value < 55) return '아바타 렌더링 중';
  if (value < 85) return '자막·타이밍 합성 중';
  return '마무리 중';
}

/** 큐에 있고 워커도 최근에 봤다 — 곧 시작한다. */
export const WAITING_STAGE = '차례를 기다리는 중';
export const WAITING_NOTE =
  '아직 렌더링이 시작되지 않았습니다. 차례가 되면 자동으로 시작되니 이 화면을 열어두세요.';

/**
 * 큐에 있는데 워커를 본 지 오래됐다.
 *
 * 수강생이 스스로 할 수 있는 일이 없는 상황이라, 다시 눌러 보라고 하지 않는다 — 그러면
 * 이번 달 생성 횟수만 한 번 더 깎인다. 잡이 사라지지 않았다는 사실과 연락할 곳을 준다.
 */
export const WORKER_DOWN_STAGE = '렌더 서버 응답 없음';
export const WORKER_DOWN_NOTE =
  '렌더 서버가 응답하지 않아 아직 시작하지 못했습니다. 만든 내용은 저장되어 있으니 다시 만들지 않아도 됩니다. 운영자에게 문의해주세요.';

export interface RenderProgressView {
  /** 진행률 옆에 굵게 뜨는 짧은 문구. */
  stage: string;
  /** 그 아래 한 줄 설명. 워커가 실제로 렌더 중이면 빈 문자열이다. */
  note: string;
  /** 눈에 띄게 보여 줘야 하는가. 워커가 없어서 멈춰 있을 때만 참. */
  alert: boolean;
}

/**
 * 잡이 아직 아무도 집어가지 않은 상태인가.
 *
 * `''`는 "서버 응답을 아직 못 받았다"이다. 그 순간 잡은 방금 큐에 들어갔으므로 같은 대접을
 * 한다 — 다만 그때 워커 생존은 모르는 값이라, 부르는 쪽이 `workerAlive`를 참으로 두고
 * 시작한다(`app/page.tsx`). 모르면서 "렌더 서버가 응답하지 않습니다"라고 말하지 않는다.
 */
function awaitingWorker(jobStatus: string): boolean {
  return jobStatus === '' || jobStatus === 'queued';
}

export function renderProgressView(input: {
  /** 서버가 준 잡 상태(`queued`·`claimed`·`rendering`…). 아직 못 받았으면 `''`. */
  jobStatus: string;
  /** 화면 쪽 상태. `completed` 판정에만 쓴다. */
  uiStatus: string;
  progress: number;
  workerAlive: boolean;
}): RenderProgressView {
  if (awaitingWorker(input.jobStatus)) {
    return input.workerAlive
      ? { stage: WAITING_STAGE, note: WAITING_NOTE, alert: false }
      : { stage: WORKER_DOWN_STAGE, note: WORKER_DOWN_NOTE, alert: true };
  }
  /**
   * 워커가 집어간 뒤(`claimed`·`rendering`)에는 예전 문구를 그대로 쓴다. 그때는 진행률이
   * 실제 단계를 가리키므로 사실이기 때문이다.
   *
   * 여기서 `workerAlive`를 다시 보지 않는 것은 **의도한 범위**다. 렌더 도중 워커가 죽으면
   * 잡은 `rendering`에 멈춘 채 옛 문구를 계속 보여 준다. 그 경우는 `STALE_CLAIM_MS`(15분)
   * 뒤 다시 집힐 수 있는 별개의 상태이고, 이 갈래에 섞으면 "잠깐 렌더가 오래 걸리는 중"과
   * "워커가 죽었다"를 구분하지 못한 채 경고를 띄우게 된다.
   */
  return {
    stage: progressStageLabel(input.progress, input.uiStatus),
    note: '',
    alert: false,
  };
}
