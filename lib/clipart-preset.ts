import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ClipartEntry } from './clipart';

/**
 * 프리셋 항목의 `ownerId`. 사람이 아니라 자리표시자다 — "아무 수강생의 것도 아니다"라는 뜻이다.
 * 이 값으로 저장된 항목은 `listStudentClipart`의 소유자 필터에 절대 걸리지 않는다.
 */
export const PRESET_OWNER_ID = '__preset__';

/**
 * 운영자 프리셋 라이브러리의 위치.
 *
 * **이 디렉터리는 워커가 도는 기계에만 있다.** 그림 파일이 운영자의 Codex 스킬 디렉터리
 * (`~/.codex/skills/character-clipart-library`)에 들어 있고 118MB라 저장소에 커밋하지
 * 않았기 때문이다. 워커를 다른 기계(또는 Vercel 함수)로 옮기면 이 경로에 아무것도 없고
 * `loadPresetClipart()`는 조용히 `[]`를 돌려준다. 고장으로 보이지 않는다 — 자기 캐릭터를
 * 올리지 않은 수강생의 릴스에서 캐릭터만 사라진다. 옮길 때는 디렉터리를 함께 복사하거나
 * 아티팩트 저장소로 올리고 `CLIPART_PRESET_DIR`를 그쪽으로 맞춘다.
 *
 * 호출 시점에 읽는다. 모듈 로드 시점에 고정하면 테스트가 임시 디렉터리를 가리킬 수 없다
 * (`lib/store/file-store.ts`가 `STORE_DIR`에 같은 이유로 같은 모양을 쓴다).
 */
export function presetDir(): string {
  return process.env.CLIPART_PRESET_DIR
    ?? path.join(os.homedir(), '.codex', 'skills', 'character-clipart-library');
}

/**
 * term(키워드·별칭)의 최소 길이. **낮추지 말 것.**
 *
 * 한국어는 교착어라 `걱정합니다`를 잡으려면 부분 일치가 필수인데, 바로 그래서 낱말 경계를
 * 요구할 수가 없다(`lib/clipart.ts` 주석). 그 결과 한 글자 term은 아무 문장 조각에나 걸린다.
 * 실측 카탈로그의 한 글자 term은 `돈 비 밤 쉿 예 끝` 여섯 개이고, 실제 대본에서 이렇게 걸렸다:
 * `비` ⊂ 준비·대비·비타민, `예` ⊂ 예방·예를, `돈` ⊂ 돈다면.
 * 긴 일치 우선으로는 못 막는다 — 경쟁할 더 긴 term이 카탈로그에 아예 없기 때문이다.
 *
 * 이건 이 카탈로그의 사정이 아니라 일반 규칙이다. 어떤 카탈로그가 오든 한 글자 term은
 * 우연히 걸릴 확률이 실용 가치보다 크다.
 *
 * 판단의 근거는 비대칭이다: **빠진 캐릭터는 아무도 눈치채지 못하지만, 스쿼트 설명에 붙은
 * 비 오는 캐릭터는 수강생이 자기 이름으로 발행한 릴스에 박힌 버그로 보인다.** 그래서
 * 재현율이 아니라 정밀도 쪽으로 세게 기운다.
 */
const MIN_TERM_LENGTH = 2;

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

/** 매칭에 쓸 수 있는 term인가. 공백만 남는 문자열과 한 글자 term을 여기서 다 막는다. */
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
 * 운영자 프리셋 카탈로그를 `ClipartEntry[]`로 읽는다.
 *
 * 없거나 깨졌으면 `[]`다. 던지지 않는 이유: 캐릭터가 빠지는 것과 릴스가 안 나오는 것은
 * 무게가 다르다. 프리셋은 대타이므로 대타가 없으면 그냥 캐릭터 없이 간다.
 *
 * `status`가 `ready`인 것만 쓴다 — `pending`은 그림 파일이 아직 없다.
 */
export async function loadPresetClipart(): Promise<ClipartEntry[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(presetDir(), 'assets', 'catalog.json'), 'utf8'));
  } catch {
    return [];
  }

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
