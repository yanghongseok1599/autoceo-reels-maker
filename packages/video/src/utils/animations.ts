import { interpolate } from 'remotion';

export const SPRING_PRESETS = {
  gentle: { damping: 20, stiffness: 100 },
} as const;

const ENTRY_FRAMES = 10;
const EXIT_FRAMES = 10;

/**
 * Remotion의 interpolate는 입력 범위가 **엄격히 증가**해야 한다. 짧은 씬에서 고정 상수를 그대로
 * 쓰면 값이 중복되거나 역전되어 런타임 예외가 난다. 창을 duration에 맞춰 좁히고, 창을 만들 수
 * 없을 만큼 짧으면 페이드를 생략한다.
 */
function fadeWindows(sceneDuration: number) {
  const room = Math.floor((sceneDuration - 1) / 2);
  return {
    entry: Math.min(ENTRY_FRAMES, room),
    exit: Math.min(EXIT_FRAMES, room),
  };
}

export function getEntryExitOpacity(sceneFrame: number, sceneDuration: number): number {
  const { entry, exit } = fadeWindows(sceneDuration);
  if (entry <= 0 || exit <= 0) return 1;
  return interpolate(
    sceneFrame,
    [0, entry, sceneDuration - exit, sceneDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

export function getExitBlur(sceneFrame: number, sceneDuration: number): number {
  const { exit } = fadeWindows(sceneDuration);
  if (exit <= 0) return 0;
  return interpolate(
    sceneFrame,
    [sceneDuration - exit, sceneDuration],
    [0, 8],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

export function getEntryExitScale(
  sceneFrame: number,
  sceneDuration: number,
  fps: number,
  from: number,
  to: number,
): number {
  const mid = Math.min(Math.round(fps * 0.5), sceneDuration - 1);
  if (mid <= 0) return to;
  return interpolate(
    sceneFrame,
    [0, mid, sceneDuration],
    [from, 1, to],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}
