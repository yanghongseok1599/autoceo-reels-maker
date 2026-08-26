import { staticFile } from 'remotion';

const REMOTE = /^(https?:\/\/|blob:|data:)/;

/**
 * `ReelProps.audioUrl`은 두 가지 중 하나다:
 * 1) `https://...` 절대 URL — 그대로 쓴다.
 * 2) Remotion public 루트 기준 상대 경로(예: `generated-audio/ab.mp3`) — `staticFile()`로 감싼다.
 *
 * 절대 **파일시스템** 경로(`/Users/...`)는 둘 다 아니다. 그걸 넘기면 `staticFile()`이
 * TypeError를 던진다 — 렌더가 성공하면서 소리만 없는 결과보다 그 편이 낫다.
 */
export function resolveAudioSrc(audioUrl: string): string {
  return REMOTE.test(audioUrl) ? audioUrl : staticFile(audioUrl);
}
