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
const KEY = 'fish-voices';

async function readAll(): Promise<FishVoiceProfile[]> {
  const profiles = await store.read<FishVoiceProfile[]>(KEY, []);
  return Array.isArray(profiles) ? profiles : [];
}

/** 그 수강생이 만든 목소리만 돌려준다. 소유자 없는 기록은 아무에게도 보이지 않는다. */
export async function listFishVoices(ownerId: string): Promise<FishVoiceProfile[]> {
  if (!ownerId) return [];
  return (await readAll()).filter((profile) => profile.ownerId === ownerId);
}

export async function upsertFishVoice(profile: FishVoiceProfile): Promise<FishVoiceProfile> {
  const profiles = await readAll();
  await store.write(KEY, [profile, ...profiles.filter((item) => item.id !== profile.id)]);
  return profile;
}

/** 이 수강생이 그 목소리를 쓸 수 있는가. 렌더 요청에서 남의 id를 대는 걸 막는 검사다. */
export async function ownsFishVoice(ownerId: string, voiceId: string): Promise<boolean> {
  if (!ownerId || !voiceId) return false;
  return (await readAll()).some(
    (profile) => profile.id === voiceId && profile.ownerId === ownerId,
  );
}
