import os from 'node:os';
import path from 'node:path';
import { MIN_TERM_LENGTH, type ClipartEntry } from './clipart';
import committedCatalog from '../data/preset-clipart-catalog.json';

/**
 * 프리셋 항목의 `ownerId`. 사람이 아니라 자리표시자다 — "아무 수강생의 것도 아니다"라는 뜻이다.
 * 이 값으로 저장된 항목은 `listStudentClipart`의 소유자 필터에 절대 걸리지 않는다.
 */
export const PRESET_OWNER_ID = '__preset__';

/**
 * 운영자 프리셋 **그림 파일**의 위치. 카탈로그(무엇이 있는지)는 여기서 읽지 않는다 —
 * 아래 `loadPresetClipart` 주석에 이유를 적어 뒀다.
 *
 * 그림 파일은 운영자의 Codex 스킬 디렉터리(`~/.codex/skills/character-clipart-library`)에
 * 들어 있고 118MB라 저장소에 커밋하지 않았다. **이 디렉터리는 워커가 도는 기계에만 있다.**
 * 쓰는 곳은 한 곳뿐이다: `worker/render.ts`의 `copyClipart`가 `presetDir()`에 항목의
 * `file`(프리셋 디렉터리 기준 상대 경로)을 이어 붙여 원본 바이트를 렌더 publicDir로 옮긴다.
 * 워커를 다른 기계로 옮기면 디렉터리를 함께 복사하고 `CLIPART_PRESET_DIR`를 그쪽으로 맞춘다.
 * 원본이 없으면 그 항목은 조용히 건너뛰고 캐릭터 없이 렌더된다(`copyClipart` 주석).
 *
 * 호출 시점에 읽는다. 모듈 로드 시점에 고정하면 테스트가 임시 디렉터리를 가리킬 수 없다
 * (`lib/store/file-store.ts`가 `STORE_DIR`에 같은 이유로 같은 모양을 쓴다).
 */
export function presetDir(): string {
  return process.env.CLIPART_PRESET_DIR
    ?? path.join(os.homedir(), '.codex', 'skills', 'character-clipart-library');
}

/**
 * 프리셋에서 솎아 내는 별칭. **되돌리지 말 것** — 아래가 실측에서 오검출한 원인이고,
 * 다시 넣으면 그대로 재발한다. 검사는 `lib/__tests__/clipart-preset.test.ts`에 있다.
 *
 * | 별칭 | 원래 항목 | 어디에 잘못 걸렸나 |
 * |---|---|---|
 * | `소식` | 뉴스 | `소식하는 습관이 체중을 바꿉니다` — 소식(小食)은 뉴스가 아니다 |
 * | `화제` | 바이럴 | `소화제에 의존하지 마세요` — 소-화제 |
 * | `기상` | 아침 | `기상청 예보를 확인하세요` |
 * | `지침` | 피곤 | `운동 지침에 따르면` — 지침(가이드라인)은 지치는 게 아니다 |
 *
 * 넷 다 두 글자라 길이 규칙으로는 걸러지지 않고, 넷 다 흔한 낱말의 조각이라 이 앱의 대본
 * (피트니스·식단)에서 반복해 터진다. 항목 자체는 남는다 — 그림은 다른 별칭으로 계속 닿는다
 * (뉴스=`보도`·`기사`, 바이럴=`입소문`, 아침=`아침 시간`, 피곤=`피로`·`힘들다`).
 *
 * 운영자 자신의 카탈로그이므로 이렇게 솎아 내는 건 정당한 손질이다. 다만 **별칭에만** 건다:
 * 나중에 운영자가 이 낱말을 키워드로 쓰는 항목을 만들면 항목이 통째로 사라져 원인을 찾기
 * 어려워진다.
 */
const CURATED_OUT_ALIASES = new Set(['소식', '화제', '기상', '지침']);

/**
 * 여기서 **고치지 않는** 것: 동음이의어.
 *
 * `사과`는 과일이면서 사과(apology)다. 프리셋의 `사과` 항목은 고개 숙인 캐릭터인데
 * `사과 한 개는 100칼로리입니다`에도 걸린다. `충격`(놀람)이 `충격을 흡수하며 착지합니다`에
 * 걸리는 것도 같은 종류다. 길이로도, 카탈로그 손질로도, 이 자리에서 쓸 수 있는 어떤 규칙으로도
 * 갈리지 않는다 — 갈리려면 문맥이 필요하다.
 *
 * 점수 휴리스틱을 지어내 쫓지 않는다. 그런 규칙은 잡는 오검출보다 깨는 정상 일치가 더 많고,
 * 왜 어떤 씬에만 캐릭터가 없는지 아무도 설명하지 못하게 된다.
 *
 * 감수하는 이유: **프리셋은 자기 캐릭터를 아직 안 올린 수강생의 대타일 뿐이다.** 올린
 * 수강생은 키워드를 자기가 정하므로 자기 정밀도를 자기가 쥔다. 남은 동음이의는 대타 자리의
 * 한계이지 모두가 겪는 고장이 아니다.
 */

/** 실측 카탈로그의 한 항목. 운영자가 손으로 고치는 JSON이라 어떤 필드도 믿지 않는다. */
type RawItem = {
  keyword?: unknown;
  aliases?: unknown;
  category?: unknown;
  file?: unknown;
  status?: unknown;
};

/**
 * 매칭에 쓸 수 있는 term인가. 공백만 남는 문자열과 한 글자 term을 여기서 다 막는다.
 *
 * `MIN_TERM_LENGTH`는 `lib/clipart.ts`에 산다 — 이 카탈로그만의 규칙이 아니라 매칭 방식
 * 자체의 조건이고, 수강생 업로드 라우트(`app/api/clipart/route.ts`)도 같은 값을 써야 한다.
 * 이유는 그쪽 주석에 적어 뒀다.
 */
function usableTerm(term: unknown): term is string {
  return typeof term === 'string' && term.trim().length >= MIN_TERM_LENGTH;
}

function itemsOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const items = (raw as { items?: unknown }).items;
    if (Array.isArray(items)) return items;
  }
  return [];
}

/**
 * 운영자 프리셋 카탈로그를 `ClipartEntry[]`로 손질한다. 순수 함수다 — 파일도 환경변수도
 * 보지 않는다. 프리셋의 규칙(ready만·두 글자 이상·솎아 낸 별칭)은 **전부 여기 있다.**
 * 동기화 스크립트는 이 규칙을 한 번도 적용하지 않으므로, 규칙이 두 번 걸리거나 한 번도
 * 안 걸리는 상태가 생기지 않는다.
 *
 * 깨진 입력에 던지지 않는 이유: 캐릭터가 빠지는 것과 릴스가 안 나오는 것은 무게가 다르다.
 * 프리셋은 대타이므로 대타가 없으면 그냥 캐릭터 없이 간다.
 *
 * `status`가 `ready`인 것만 쓴다 — `pending`은 그림 파일이 아직 없다.
 */
export function parsePresetCatalog(raw: unknown): ClipartEntry[] {
  const entries: ClipartEntry[] = [];
  for (const item of itemsOf(raw)) {
    if (!item || typeof item !== 'object') continue;
    const { keyword, aliases, category, file, status } = item as RawItem;

    if (status !== 'ready') continue;
    if (typeof file !== 'string' || !file.trim()) continue;
    // 키워드가 한 글자면 항목째 버린다. 남는 건 별칭뿐인데, 그 항목은 실제로는 다른 낱말을
    // 뜻하면서 `preset:비`라는 이름을 달고 다니게 된다.
    if (!usableTerm(keyword)) continue;

    entries.push({
      id: `preset:${keyword.trim()}`,
      ownerId: PRESET_OWNER_ID,
      keyword: keyword.trim(),
      aliases: (Array.isArray(aliases) ? aliases : [])
        .filter(usableTerm)
        .map((alias) => alias.trim())
        .filter((alias) => !CURATED_OUT_ALIASES.has(alias)),
      category: typeof category === 'string' ? category : '',
      source: 'preset',
      file: file.trim(),
    });
  }
  return entries;
}

/**
 * 이 수강생의 릴스에 쓰일 운영자 프리셋 카탈로그.
 *
 * **저장소에 커밋된 `data/preset-clipart-catalog.json`을 정적으로 import 한다. 파일시스템도
 * `CLIPART_PRESET_DIR`도 보지 않는다.** 이 함수를 부르는 프로세스가 둘이기 때문이다:
 * 앱(Vercel)의 `GET /api/clipart`가 수강생에게 "이 낱말이 캐릭터를 부릅니다"라고 말하고,
 * 워커(운영자 맥)의 `remotionEngine.produce`가 실제로 그 캐릭터를 릴스에 넣는다.
 *
 * 예전에는 양쪽이 각자 `presetDir()/assets/catalog.json`을 읽었다. 개발 기계에서는 같은
 * 파일이라 맞았지만 **배포에서는 갈라졌다**: 앱은 `{"entries":[],"usingPreset":true}`를
 * 돌려주며 "어떤 낱말이 캐릭터를 부르는지" 칩을 하나도 못 띄우는데, 같은 대본으로 만든
 * 릴스에는 워커가 자기 디스크에서 읽은 운영자 캐릭터 세 개가 그대로 들어갔다
 * (`task-7-report.md`의 F1 — 실제로 재현했다). 수강생은 캐릭터가 나온다는 사실조차
 * 듣지 못한 채 남의 얼굴이 든 릴스를 받는다.
 *
 * 그림 파일(118MB)은 여전히 워커 기계에만 있다. **나뉘는 지점은 바이트와 메타데이터다** —
 * 메타데이터는 작으므로 커밋해서 양쪽이 같은 답을 하고, 바이트는 워커가 `presetDir()`에
 * 항목의 `file`을 이어 붙여 계속 자기 디스크에서 찾는다.
 *
 * 정적 import인 이유: `readFile`로 저장소 경로를 읽으면 Vercel 함수 번들에 그 파일이
 * 딸려 갈 보장이 없어(경로가 정적 분석되지 않는다) 배포에서만 다시 빈 카탈로그가 된다.
 * import는 번들러가 반드시 포함시키고, 카탈로그가 깨져 있으면 배포가 아니라 빌드가 깨진다.
 *
 * 비동기 서명을 유지한다. 호출자(`catalogFor`)는 저장소를 함께 읽으므로 여기만 동기로
 * 바꿔 봐야 얻는 게 없고, 서명이 바뀌면 부르는 자리를 모두 건드려야 한다.
 */
export async function loadPresetClipart(): Promise<ClipartEntry[]> {
  return parsePresetCatalog(committedCatalog);
}
