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

const REVEAL_FRAMES = 10;
const MAX_STAGGER_FRAMES = 8;

/**
 * 씬 안에서 항목을 순차로 등장시킬 때 쓰는 타이밍. 항목 i는 `i * stagger` 프레임에 등장을
 * 시작해 `reveal` 프레임 뒤에 완전히 또렷해진다.
 *
 * 간격을 상수로 고정하면 안 된다. 항목이 많거나 씬이 짧으면 마지막 항목이 **퇴장 페이드가
 * 시작된 뒤에야** 또렷해진다 — 6항목 x 8프레임이면 48프레임이 필요한데 1.5초(45프레임)
 * 씬의 페이드 아웃은 35프레임에 시작한다. 씬 길이를 만드는 쪽(파이프라인)은 이 계약을
 * 알 수 없으므로 여기서 잘라낸다. 여유가 있으면 MAX_STAGGER_FRAMES를 그대로 쓴다.
 */
export function getStaggerTiming(
  sceneDuration: number,
  itemCount: number,
): { stagger: number; reveal: number; exitStart: number } {
  const { exit } = fadeWindows(sceneDuration);
  // 페이드를 만들 수 없을 만큼 짧은 씬은 퇴장 페이드 자체가 없다 — 씬 끝까지 다 쓴다.
  const exitStart = exit > 0 ? sceneDuration - exit : Math.max(1, sceneDuration);
  const reveal = Math.max(1, Math.min(REVEAL_FRAMES, exitStart));
  const gaps = Math.max(1, itemCount - 1);
  const stagger = Math.max(0, Math.min(MAX_STAGGER_FRAMES, Math.floor((exitStart - reveal) / gaps)));
  return { stagger, reveal, exitStart };
}
