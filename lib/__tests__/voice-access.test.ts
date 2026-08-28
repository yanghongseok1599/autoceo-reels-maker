import { describe, it, expect } from 'vitest';
import {
  authorizeVoice,
  VOICE_NOT_REGISTERED,
  VOICE_NOT_SELECTED,
  VOICE_NOT_YOURS,
} from '../voice-access';
import { upsertFishVoice, type FishVoiceProfile } from '../fish-voice-store';

const voice = (id: string, ownerId: string): FishVoiceProfile => ({
  id,
  ownerId,
  name: `${ownerId}의 목소리 ${id}`,
  language: 'ko',
  sampleCount: 1,
  createdAt: '2026-08-26T00:00:00Z',
});

/**
 * 목소리가 **한 개뿐인** 수강생만 검사하면 "내 목록에 그게 있는가"(`some`)와 "내 목록이
 * 그것뿐인가"(`every`)가 같은 답을 낸다 — 두 검사가 갈리는 건 목록이 둘 이상일 때다.
 * 그 자리를 비워 두면 경계 검사가 통과만 하는 빈 검사로 조용히 바뀐다.
 */
describe('authorizeVoice — 목소리를 여럿 가진 수강생', () => {
  it('accepts a voice that is not the only one the caller owns', async () => {
    await upsertFishVoice(voice('first', 'u1'));
    await upsertFishVoice(voice('second', 'u1'));

    expect(await authorizeVoice('u1', 'second')).toEqual({ ok: true, voiceId: 'second' });
  });

  it('accepts either of the caller two voices, not merely the newest', async () => {
    await upsertFishVoice(voice('first', 'u1'));
    await upsertFishVoice(voice('second', 'u1'));

    expect(await authorizeVoice('u1', 'first')).toEqual({ ok: true, voiceId: 'first' });
  });

  it('refuses a voice id nobody owns even while the caller owns several', async () => {
    await upsertFishVoice(voice('first', 'u1'));
    await upsertFishVoice(voice('second', 'u1'));

    expect(await authorizeVoice('u1', 'nobodys-voice')).toEqual({
      ok: false,
      status: 400,
      error: VOICE_NOT_YOURS,
    });
  });

  it("refuses another student's voice while the caller owns several", async () => {
    await upsertFishVoice(voice('first', 'u1'));
    await upsertFishVoice(voice('second', 'u1'));
    await upsertFishVoice(voice('theirs', 'u2'));

    expect(await authorizeVoice('u1', 'theirs')).toEqual({
      ok: false,
      status: 400,
      error: VOICE_NOT_YOURS,
    });
  });

  /** "없는 목소리"와 "남의 목소리"를 나누기 전에, 등록·선택 안내가 먼저 걸린다. */
  it('asks the caller to register before anything else when they own none', async () => {
    expect(await authorizeVoice('u1', 'second')).toEqual({
      ok: false,
      status: 400,
      error: VOICE_NOT_REGISTERED,
    });
  });

  it('asks the caller to pick one when they own several but sent no id', async () => {
    await upsertFishVoice(voice('first', 'u1'));
    await upsertFishVoice(voice('second', 'u1'));

    expect(await authorizeVoice('u1', '  ')).toEqual({
      ok: false,
      status: 400,
      error: VOICE_NOT_SELECTED,
    });
  });
});
