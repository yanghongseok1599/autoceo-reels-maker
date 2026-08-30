import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { store } from '@/lib/store';
import {
  HEARTBEAT_WRITE_INTERVAL_MS,
  WORKER_ALIVE_WINDOW_MS,
  isWorkerAlive,
  recordWorkerSeen,
} from '@/lib/worker-liveness';

const T0 = new Date('2026-08-29T09:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

/**
 * 저장소가 깨진 JSON을 만나면 **던진다**(`lib/store/file-store.ts`). 그 예외가 여기까지
 * 새어 나오면 워커 폴링이 500으로 죽고, 수강생 화면은 상태 확인 실패로 넘어간다.
 * 진단 신호 하나 때문에 큐가 멈추는 그 상태를 만들어 본다.
 */
function corruptHeartbeatFile(): void {
  writeFileSync(path.join(process.env.STORE_DIR!, 'worker-heartbeat.json'), '{ 반쪽짜리', 'utf8');
}

/** 저장소에 실제로 남은 값. 스로틀이 "안 썼다"고 말할 때 정말 안 썼는지 본다. */
async function storedLastSeenAt(): Promise<string | null> {
  const value = await store.read<{ lastSeenAt: string } | null>('worker-heartbeat', null);
  return value?.lastSeenAt ?? null;
}

describe('recordWorkerSeen', () => {
  it('writes the first heartbeat', async () => {
    expect(await recordWorkerSeen(T0)).toBe(true);
    expect(await storedLastSeenAt()).toBe(T0.toISOString());
  });

  /**
   * 스로틀의 본론. 워커는 5초마다 폴링하므로 이게 없으면 하루 17,280번 쓴다.
   * 저장된 값이 **첫 시각 그대로**인지까지 본다 — 반환값만 보면 "쓰고도 false를 답하는"
   * 구현을 통과시킨다.
   */
  it('holds the next write back for a full 30 seconds', async () => {
    // 값을 직접 고정한다. 검사를 상수로만 쓰면 상수가 무엇으로 바뀌든 함께 따라가서,
    // "30초에 한 번"이라는 이 기능의 유일한 비용 약속을 아무것도 지키지 않게 된다.
    expect(HEARTBEAT_WRITE_INTERVAL_MS).toBe(30_000);
    await recordWorkerSeen(T0);
    expect(await recordWorkerSeen(at(29_999))).toBe(false);
    expect(await storedLastSeenAt()).toBe(T0.toISOString());
  });

  /** 같은 밀리초에 두 번 불려도 한 번만 쓴다(`>= 0`이 `> 0`으로 좁아지면 여기서 깨진다). */
  it('does not write again when called twice at the same instant', async () => {
    await recordWorkerSeen(T0);
    expect(await recordWorkerSeen(T0)).toBe(false);
  });

  it('writes again once the throttle window has elapsed', async () => {
    await recordWorkerSeen(T0);
    const later = at(30_000);
    expect(await recordWorkerSeen(later)).toBe(true);
    expect(await storedLastSeenAt()).toBe(later.toISOString());
  });

  /** 시계가 뒤로 가도 갱신이 막히면 안 된다 — 그러면 워커가 영영 죽은 것으로 보인다. */
  it('writes when the clock has gone backwards', async () => {
    await recordWorkerSeen(T0);
    const earlier = at(-60_000);
    expect(await recordWorkerSeen(earlier)).toBe(true);
    expect(await storedLastSeenAt()).toBe(earlier.toISOString());
  });

  it('writes over a heartbeat file it cannot read at all', async () => {
    corruptHeartbeatFile();
    expect(await recordWorkerSeen(T0)).toBe(true);
    expect(await storedLastSeenAt()).toBe(T0.toISOString());
  });

  it('writes over a stored value it cannot parse', async () => {
    await store.write('worker-heartbeat', { lastSeenAt: '언제인지 모를 값' });
    expect(await recordWorkerSeen(T0)).toBe(true);
    expect(await storedLastSeenAt()).toBe(T0.toISOString());
  });
});

describe('isWorkerAlive', () => {
  it('is false when no worker has ever polled', async () => {
    expect(await isWorkerAlive(T0)).toBe(false);
  });

  it('is true right after the worker polled', async () => {
    await recordWorkerSeen(T0);
    expect(await isWorkerAlive(T0)).toBe(true);
  });

  /**
   * 창은 쓰기 간격보다 넓어야 한다. 멀쩡한 워커의 하트비트도 최대 30초까지 낡기 때문이다.
   */
  it('is still true one millisecond before the 90 second window closes', async () => {
    expect(WORKER_ALIVE_WINDOW_MS).toBe(90_000);
    await recordWorkerSeen(T0);
    expect(await isWorkerAlive(at(89_999))).toBe(true);
  });

  it('is false once the window has closed', async () => {
    await recordWorkerSeen(T0);
    expect(await isWorkerAlive(at(90_000))).toBe(false);
  });

  /**
   * 두 상수의 **관계**가 이 기능이 서 있는 자리다. 창이 쓰기 간격보다 좁으면 스로틀이
   * 붙잡아 둔 30초 동안 멀쩡한 워커가 죽은 것으로 읽히고, 화면은 아무 일도 없는데
   * "렌더 서버 응답 없음"을 띄운다 — 이 작업이 없애려던 거짓말의 반대 방향이다.
   */
  it('still counts a heartbeat the throttle held back for a full interval', async () => {
    expect(WORKER_ALIVE_WINDOW_MS).toBeGreaterThan(HEARTBEAT_WRITE_INTERVAL_MS);
    await recordWorkerSeen(T0);
    expect(await isWorkerAlive(at(30_000))).toBe(true);
  });

  it('survives a heartbeat stamped slightly in the future', async () => {
    await recordWorkerSeen(at(5_000));
    expect(await isWorkerAlive(T0)).toBe(true);
  });

  it('reports no worker rather than throwing when the heartbeat is unreadable', async () => {
    corruptHeartbeatFile();
    await expect(isWorkerAlive(T0)).resolves.toBe(false);
  });

  it('is false when the stored timestamp cannot be parsed', async () => {
    await store.write('worker-heartbeat', { lastSeenAt: '언제인지 모를 값' });
    expect(await isWorkerAlive(T0)).toBe(false);
  });
});
