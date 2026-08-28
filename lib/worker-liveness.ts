import { store } from './store';

/**
 * 렌더 워커가 살아 있다는 사실이 사는 **자기 키.**
 *
 * 어느 배열에도 붙이지 않는다. 이 저장소는 바로 앞 브랜치에서 공유 배열의 읽기-수정-쓰기가
 * 서로를 지우는 것 때문에 `jobs`를 `jobs/<id>`로 쪼갰다(`lib/jobs.ts` 주석). 하트비트는
 * 5초마다 오는 **가장 잦은 쓰기**라, 그걸 다시 남의 배열에 얹으면 그 결함을 제일 나쁜
 * 자리에 새로 심는 꼴이다. 쓰는 사람은 하나(`POST /api/jobs/next`), 키도 하나다.
 */
const HEARTBEAT_KEY = 'worker-heartbeat';

/**
 * 하트비트를 **다시 쓰기까지 기다리는 최소 간격.**
 *
 * 워커는 5초마다 폴링한다(`worker/index.ts`의 `INTERVAL_MS`). 폴링마다 쓰면 하루 17,280번이고,
 * 배포 저장소(Vercel Blob)는 쓰기 한 번마다 돈을 받는다. 30초로 조이면 하루 2,880번이다.
 * 30초 낡은 하트비트로도 "켜져 있다"와 "꺼져 있다"는 충분히 갈린다 — 이 값이 사는 이유가
 * 정확히 그 둘을 가르는 것이고, 그보다 더 정밀한 값은 아무 화면도 쓰지 않는다.
 */
export const HEARTBEAT_WRITE_INTERVAL_MS = 30 * 1000;

/**
 * 이 시간 안에 폴링한 흔적이 있으면 워커가 살아 있다고 본다.
 *
 * 쓰기 간격(30초)보다 반드시 넉넉해야 한다. 멀쩡한 워커의 하트비트도 최대 30초까지 낡을 수
 * 있으므로 창을 30초로 두면 정상 워커가 주기적으로 죽은 것처럼 보인다. 90초는 쓰기 창을
 * 세 번 놓쳐야 죽었다고 말한다는 뜻이다.
 *
 * 대가는 **감지가 최대 90초 늦다**는 것이다. 반대 방향으로 틀리는 것보다 낫다:
 * 멀쩡히 돌고 있는데 "렌더 서버가 응답하지 않습니다"를 보여 주면, 그건 이 작업이
 * 없애려는 바로 그 거짓말을 방향만 바꿔 다시 하는 것이다.
 */
export const WORKER_ALIVE_WINDOW_MS = 90 * 1000;

interface WorkerHeartbeat {
  lastSeenAt: string;
}

async function readHeartbeat(): Promise<WorkerHeartbeat | null> {
  try {
    return await store.read<WorkerHeartbeat | null>(HEARTBEAT_KEY, null);
  } catch {
    /**
     * 못 읽으면 "본 적 없다"로 답한다.
     *
     * 이 값은 잡이나 목소리 같은 원본이 아니라 **파생 신호**라, 저장소가 시끄럽게 던지는
     * 규칙(`lib/store/file-store.ts`)을 여기까지 끌고 올 이유가 없다. 게다가 이 신호를 읽지
     * 못하는 상태라면 워커의 `claimNextJob`도 같은 저장소에서 같은 이유로 아플 가능성이
     * 크다 — 그때 수강생에게 할 말은 "운영자에게 문의"가 맞다.
     */
    return null;
  }
}

function writeDue(lastSeenAt: string, now: Date): boolean {
  const elapsed = now.getTime() - Date.parse(lastSeenAt);
  /**
   * 값이 이상하면(파싱 실패로 `NaN`, 또는 시계가 뒤로 가서 음수) **쓴다.** 두 비교가 모두
   * 거짓이 되어 자연스럽게 그렇게 되지만, 그게 의도다: 여기서 막히면 하트비트가 영영
   * 갱신되지 않고 워커가 영영 죽은 것으로 보인다. 스로틀은 비용을 아끼려고 있는 것이지
   * 갱신을 막으려고 있는 게 아니다.
   */
  return !(elapsed >= 0 && elapsed < HEARTBEAT_WRITE_INTERVAL_MS);
}

/**
 * 워커가 방금 폴링했다는 사실을 남긴다. `POST /api/jobs/next`가 부른다.
 *
 * 쓰기 전에 한 번 읽는다. 프로세스 안의 변수로 조이면 읽기는 아끼지만, Vercel은 인스턴스가
 * 여러 개라 인스턴스 수만큼 쓰기가 늘고 "30초에 한 번"이 더 이상 사실이 아니게 된다.
 * 읽기는 쓰기보다 싸고, 이 자리에서 지켜야 하는 약속은 **쓰기 횟수**다.
 *
 * @returns 실제로 썼으면 `true`, 스로틀에 걸려 건너뛰었으면 `false`
 */
export async function recordWorkerSeen(now: Date = new Date()): Promise<boolean> {
  const current = await readHeartbeat();
  if (current && !writeDue(current.lastSeenAt, now)) return false;
  await store.write<WorkerHeartbeat>(HEARTBEAT_KEY, { lastSeenAt: now.toISOString() });
  return true;
}

/**
 * 워커를 최근에 본 적이 있는가. 화면이 "차례를 기다리는 중"과 "렌더 서버 응답 없음"을
 * 가르는 데 쓰는 **유일한** 근거다.
 *
 * 이 값은 워커 하나에 대한 사실이지 어떤 수강생의 것도 아니다 — 그래서 이걸 응답에 실어도
 * 소유자 경계는 그대로다. 다만 **잡 소유자 확인을 통과한 뒤에** 물어야 한다.
 */
export async function isWorkerAlive(now: Date = new Date()): Promise<boolean> {
  const current = await readHeartbeat();
  if (!current) return false;
  const elapsed = now.getTime() - Date.parse(current.lastSeenAt);
  // 앞선 시계(음수)는 살아 있는 것으로 본다. 워커와 앱의 시계가 조금 어긋났다는 뜻일 뿐이다.
  // `NaN`(깨진 값)은 어느 비교도 통과하지 못해 "본 적 없다"가 된다.
  return elapsed < WORKER_ALIVE_WINDOW_MS;
}
