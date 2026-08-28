import { randomUUID } from 'node:crypto';
import type { ClipartEntry } from './clipart';
import { loadPresetClipart } from './clipart-preset';
import { store } from './store';

/**
 * 수강생이 올린 캐릭터 그림은 **그 사람의 것**이다. 목소리(`lib/fish-voice-store.ts`)와
 * 같은 경계이고, 같은 모양으로 지킨다: 저장은 `store` 한 곳에, 읽기는 항상 `ownerId` 필터를
 * 지나서. 그래야 수강생 A의 목록에 B의 캐릭터가 뜨는 일이 생기지 않는다.
 *
 * 직접 `readFile`/`writeFile` 하지 않는 이유도 목소리와 같다 — Vercel의 파일시스템은
 * 읽기 전용이라 배포하면 업로드가 조용히 실패하고 목록은 늘 비어 있게 된다.
 */

/**
 * 소유자당 키 하나. 예전에는 모두의 클립아트가 `clipart-library` 배열 하나에 있었고,
 * 업로드 한 번이 그 배열 전체를 읽고 고쳐 다시 쓰는 일이었다. 두 수강생이 같은 순간에
 * 올리면 나중에 쓴 쪽이 앞선 쪽의 캐릭터를 지웠다. 키를 나누면 겹칠 자리 자체가 없다.
 */
const keyFor = (ownerId: string) => `clipart-library/${ownerId}`;

async function readAll(ownerId: string): Promise<ClipartEntry[]> {
  const entries = await store.read<ClipartEntry[]>(keyFor(ownerId), []);
  return Array.isArray(entries) ? entries : [];
}

/**
 * 새 항목의 id를 만든다. **저장소를 건드리지 않는다** — 그래서 저장보다 먼저 부를 수 있다.
 *
 * 업로드 경로에 순환이 있었기 때문에 이 함수가 따로 있다: 그림이 올라갈 자리는
 * `clipartAssetKey(entry)`가 정하고, 그건 `id`를 해싱한다. 그런데 저장할 `file`은 업로드가
 * 끝나야 나오는 값이다. 저장 함수가 id를 만들면 "id를 얻으려면 저장해야 하는데, 저장하려면
 * `file`이 있어야 하고, `file`을 얻으려면 id가 있어야 한다"가 된다.
 *
 * id를 만드는 데는 아무것도 읽거나 쓸 필요가 없다. 그래서 호출자가 먼저 id를 쥐고 그 키로
 * 올린 뒤 한 번만 저장한다 — 2단계 upsert가 필요 없고, 업로드가 실패해도 반쯤 저장된 항목이
 * 남지 않는다.
 *
 * 무작위다. 결정적 id(`<ownerId>:<keyword>`)로 하면 같은 사람이 같은 키워드를 다시 올릴 때
 * 이전 그림을 덮는다.
 */
export function newClipartId(): string {
  return `clipart_${randomUUID()}`;
}

/**
 * 그 수강생이 올린 것만 돌려준다. 소유자가 빈 값이면 아무것도 주지 않는다(전부가 아니라).
 *
 * 키가 이미 소유자를 나누지만 선가드와 필터는 둘 다 남긴다. 방어가 한 겹뿐이면 나중에
 * 키 구조를 바꿀 때 경계가 조용히 열린다.
 */
export async function listStudentClipart(ownerId: string): Promise<ClipartEntry[]> {
  if (!ownerId) return [];
  return (await readAll(ownerId)).filter((entry) => entry.ownerId === ownerId);
}

/**
 * 수강생 업로드를 저장한다. `id`는 호출자가 `newClipartId()`로 미리 만들어 넘긴다 —
 * 그림을 이미 그 id로 계산한 자리에 올려 뒀기 때문이다(위 `newClipartId` 주석).
 *
 * **`source`만은 호출자가 정하지 못한다.** 업로드가 `preset`으로 들어오면 렌더는 원본을
 * 프리셋 디렉터리에서 찾다 실패하고 그림이 조용히 사라진다(`ClipartEntry.source` 주석).
 * 여기서 오는 것은 정의상 수강생 업로드다.
 *
 * **같은 소유자가 같은 키워드를 다시 올리면 덧붙이지 않고 갈아 끼운다.**
 *
 * 덧붙이면 같은 키워드를 가진 항목이 둘 남고, `matchClipart`는 term 길이가 같을 때 앞선
 * 항목을 고르므로 **새로 올린 그림이 절대 이기지 못한다.** 수강생 눈에는 "다시 올렸는데
 * 아무것도 안 바뀐다"로 보인다 — 원인을 짐작할 단서가 화면 어디에도 없고, 잘못된 키워드를
 * 고칠 유일한 방법이 막힌다. 없는 기능보다 나쁘다: 앱이 고장 났다고 가르치는 쪽이다.
 *
 * **id는 새것이다**(호출자가 이미 새로 만들어 넘겼다). 이 점이 중요하다 —
 * `clipartAssetKey`는 id를 해싱하므로 새 id면 새 그림이 **새 자리**에 올라가고, 옛 그림은
 * 아무도 안 보는 채로 남는다. id를 재사용해 같은 자리를 덮으면 지금 진행 중인 렌더가
 * 가져가는 중인 파일을 갈아 끼우게 된다. 버려진 blob은 무해하지만 바뀌는 blob은 아니다.
 *
 * 지우는 게 아니다. 항목 수는 그대로이고, 어떤 렌더도 없는 파일을 가리키게 되지 않는다.
 *
 * **자리를 지킨다**(빼고 뒤에 붙이지 않는다). `matchClipart`는 동점일 때 앞선 항목을 고르므로
 * 순서가 바뀌면 이 항목과 무관한 다른 대본의 결과까지 흔들린다. 갈아 끼우는 건 그림이지
 * 카탈로그 순서가 아니다.
 *
 * 새 키워드는 뒤에 붙인다(앞이 아니라). 같은 이유다 — 새 업로드가 앞으로 끼어들면 이미 잘
 * 나오던 대본이 다른 그림을 내기 시작한다.
 */
export async function addStudentClipart(
  entry: Omit<ClipartEntry, 'source'>,
): Promise<ClipartEntry> {
  const saved: ClipartEntry = { ...entry, source: 'student' };
  const all = await readAll(saved.ownerId);
  // 소유자까지 함께 본다. 키워드만 보면 수강생 A가 `기쁨`을 올릴 때 B의 `기쁨`이 사라진다.
  const at = all.findIndex((e) => e.ownerId === saved.ownerId && e.keyword === saved.keyword);

  const next = at >= 0 ? all.map((e, i) => (i === at ? saved : e)) : [...all, saved];
  await store.write(keyFor(saved.ownerId), next);
  return saved;
}

/**
 * 이 수강생의 릴스에 쓸 카탈로그.
 *
 * **자기 것이 하나라도 있으면 그것만 쓴다. 프리셋과 섞지 않는다.** 섞으면 한 영상 안에
 * 자기 캐릭터와 남(운영자)의 캐릭터가 같이 나온다 — 매칭되는 씬마다 얼굴이 바뀌는 셈이라
 * 캐릭터를 올린 의미가 사라진다. 자기 카탈로그가 성기면 캐릭터 없는 씬이 늘 뿐이고,
 * 그건 얼굴이 섞이는 것보다 훨씬 가볍다.
 *
 * `usingPreset`은 UI가 "기본 캐릭터입니다" 안내를 띄우는 근거다. 이 값이 없으면 수강생은
 * 지금 자기 캐릭터가 쓰이는지 운영자 기본값이 쓰이는지 화면에서 알 방법이 없다.
 * 프리셋이 비어 있어도(워커 기계가 아니면 그렇다) `usingPreset`은 참이다 — "내 것이 아니다"가
 * 이 값의 뜻이지 "프리셋이 실제로 들어 있다"가 아니다.
 */
export async function catalogFor(
  ownerId: string,
): Promise<{ entries: ClipartEntry[]; usingPreset: boolean }> {
  const mine = await listStudentClipart(ownerId);
  if (mine.length > 0) return { entries: mine, usingPreset: false };
  return { entries: await loadPresetClipart(), usingPreset: true };
}
