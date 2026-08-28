import { store } from './store';

/**
 * 클론한 목소리는 **개인 정보**다. 소유자 없이 저장하면 모든 수강생의 피커에
 * 남의 목소리가 뜨고, 그 id로 남의 목소리 릴스를 만들 수 있다. `ownerId`는
 * 편의 필드가 아니라 경계다.
 */
export type FishVoiceProfile = {
  id: string;
  ownerId: string;
  name: string;
  language: string;
  sampleCount: number;
  createdAt: string;
};

/**
 * 예전에는 이 모듈이 `.local-data`에 직접 readFile/writeFile 했다. Vercel의 파일시스템은
 * 읽기 전용이라 배포하면 클론이 조용히 실패하고 목록은 늘 비어 있었다 — `students.json`이
 * 겪었던 것과 같은 고장이다. 저장소 선택은 `lib/store`에 맡긴다.
 */

/**
 * 소유자당 키 하나. 예전에는 모든 수강생의 목소리가 `fish-voices` 배열 하나에 있었고,
 * 클론 한 번이 그 배열 전체를 읽고 고쳐 다시 쓰는 일이었다. 두 수강생이 같은 순간에
 * 클론하면 나중에 쓴 쪽이 앞선 쪽의 목소리를 지웠다 — 개인 정보가 조용히 사라진다.
 * 키를 나누면 서로의 쓰기가 겹칠 자리 자체가 없다.
 */
const keyFor = (ownerId: string) => `fish-voices/${ownerId}`;

async function readAll(ownerId: string): Promise<FishVoiceProfile[]> {
  const profiles = await store.read<FishVoiceProfile[]>(keyFor(ownerId), []);
  return Array.isArray(profiles) ? profiles : [];
}

/**
 * 그 수강생이 만든 목소리만 돌려준다. 소유자 없는 기록은 아무에게도 보이지 않는다.
 *
 * 키가 이미 소유자를 나누지만 필터는 남긴다. 방어를 두 겹으로 둬야 나중에 키 구조를
 * 바꿀 때 경계가 조용히 열리지 않는다.
 */
export async function listFishVoices(ownerId: string): Promise<FishVoiceProfile[]> {
  if (!ownerId) return [];
  return (await readAll(ownerId)).filter((profile) => profile.ownerId === ownerId);
}

export async function upsertFishVoice(profile: FishVoiceProfile): Promise<FishVoiceProfile> {
  const profiles = await readAll(profile.ownerId);
  await store.write(
    keyFor(profile.ownerId),
    [profile, ...profiles.filter((item) => item.id !== profile.id)],
  );
  return profile;
}
