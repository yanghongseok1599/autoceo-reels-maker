import { listFishVoices } from './fish-voice-store';

/**
 * "이 수강생이 이 목소리를 쓸 수 있는가"에 답하는 **한 곳**.
 *
 * 목록(`/api/voicebox/profiles`)만 막고 합성(`preview`, `generate`)을 열어두면
 * 경계가 아니라 장식이다. 클론한 목소리로 임의의 문장을 만들 수 있다는 건
 * 취향 유출이 아니라 사칭이다. 그래서 목소리 id를 받는 모든 라우트가 이 함수를 통과한다.
 *
 * 라우트마다 검사를 복사하면 언젠가 한 곳이 뒤처진다. 뒤처진 그 한 곳이 구멍이다.
 */
export const VOICE_NOT_REGISTERED =
  '목소리를 먼저 등록해주세요. 내 목소리 샘플을 업로드하면 그 목소리로 영상을 만듭니다.';
export const VOICE_NOT_SELECTED = '사용할 목소리를 선택해주세요.';
export const VOICE_NOT_YOURS = '사용할 수 없는 목소리입니다. 내 목소리 목록에서 다시 선택해주세요.';

/**
 * 통과하면 **검증된 id**를 함께 돌려준다. 라우트가 검사 전의 `string | undefined`를
 * 그대로 쓰지 못하게 하려는 것이다 — 검사를 통과했다는 사실이 타입에도 남아야
 * "검사는 했는데 다른 값을 썼다"가 컴파일 단계에서 걸린다.
 */
export type VoiceAccess =
  | { ok: true; voiceId: string }
  | { ok: false; status: 400; error: string };

/**
 * "남의 목소리"와 "없는 목소리"를 같은 400·같은 문구로 답한다 — 구분해서 답하면
 * 그 id가 실재한다는 사실을 알려주는 셈이다.
 */
export async function authorizeVoice(
  ownerId: string,
  voiceId: string | undefined | null,
): Promise<VoiceAccess> {
  const voices = await listFishVoices(ownerId);

  if (voices.length === 0) return { ok: false, status: 400, error: VOICE_NOT_REGISTERED };
  if (!voiceId?.trim()) return { ok: false, status: 400, error: VOICE_NOT_SELECTED };
  if (!voices.some((voice) => voice.id === voiceId)) {
    return { ok: false, status: 400, error: VOICE_NOT_YOURS };
  }

  return { ok: true, voiceId };
}
