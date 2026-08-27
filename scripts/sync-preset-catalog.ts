/**
 * 운영자 프리셋 카탈로그의 **메타데이터**를 저장소 안으로 복사한다.
 *
 *   npx tsx scripts/sync-preset-catalog.ts
 *   npx tsx scripts/sync-preset-catalog.ts --dir /다른/프리셋/디렉터리
 *
 * 운영자가 캐릭터를 추가·수정한 뒤 이 명령을 한 번 돌리고 결과 파일을 커밋하면 된다.
 * `data/preset-clipart-catalog.json`을 손으로 고치지 않는다 — 실측 카탈로그와 어긋나는
 * 순간 앱이 말하는 키워드와 워커가 실제로 쓰는 그림이 다시 갈라진다.
 *
 * **왜 이 파일이 필요한가.** 앱은 Vercel에서 돌고 프리셋 그림과 `catalog.json`은 워커가
 * 도는 맥의 Codex 스킬 디렉터리에 있다. 둘이 각자 자기 파일시스템에서 카탈로그를 읽으면
 * 앱은 "기본 캐릭터 없음"이라고 말하면서 워커는 같은 릴스에 운영자 캐릭터 세 개를 넣는다.
 * 실제로 그렇게 됐다(`task-7-report.md`의 F1). 그림 파일(118MB)은 저장소에 넣을 수 없지만
 * 메타데이터는 작으므로, **메타데이터만 커밋해서 양쪽이 같은 파일을 읽게 한다.**
 *
 * **투영(projection)일 뿐 손질이 아니다.** 여기서는 거르지도 다듬지도 않는다 —
 * `status`가 `pending`인 항목도, 한 글자 키워드도, 솎아 낼 별칭도 그대로 옮긴다.
 * 그 규칙들은 전부 `lib/clipart-preset.ts`의 `parsePresetCatalog`에 있고, 거기 한 곳에만
 * 있어야 한다. 여기서 한 번 더 걸러 두면 규칙이 두 곳에 생겨 한쪽만 바뀌는 날이 온다.
 *
 * 그림 파일은 옮기지 않는다. `file`은 프리셋 디렉터리 기준 상대 경로 그대로이고,
 * 워커가 `presetDir()`에 이어 붙여 원본을 찾는다(`worker/render.ts`의 `copyClipart`).
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { presetDir } from '../lib/clipart-preset';

/** 커밋되는 카탈로그. `lib/clipart-preset.ts`가 정적 import로 읽는 바로 그 파일이다. */
const OUT = path.resolve(__dirname, '..', 'data', 'preset-clipart-catalog.json');

/** 커밋되는 항목의 모양. 로더(`parsePresetCatalog`)가 읽는 필드가 전부다. */
type SyncedItem = {
  keyword: unknown;
  aliases: unknown;
  category: unknown;
  file: unknown;
  status: unknown;
};

export function projectCatalog(raw: unknown): SyncedItem[] {
  const items = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { items?: unknown } | null)?.items)
      ? ((raw as { items: unknown[] }).items)
      : [];
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map((item) => ({
      keyword: item.keyword,
      aliases: item.aliases,
      category: item.category,
      file: item.file,
      status: item.status,
    }));
}

function sourceDir(argv: string[]): string {
  const at = argv.indexOf('--dir');
  return at >= 0 && argv[at + 1] ? argv[at + 1] : presetDir();
}

async function main(): Promise<void> {
  const dir = sourceDir(process.argv.slice(2));
  const from = path.join(dir, 'assets', 'catalog.json');

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(from, 'utf8'));
  } catch (error) {
    // 로더는 카탈로그를 못 읽어도 조용히 `[]`를 돌려준다(캐릭터 없는 릴스가 릴스 없는 것보다
    // 낫다). 여기서는 반대다 — 운영자가 동기화를 하러 왔는데 아무 일도 안 일어나면
    // 빈 카탈로그를 커밋해 모든 수강생의 기본 캐릭터를 지우게 된다.
    console.error(`프리셋 카탈로그를 읽지 못했습니다: ${from}`);
    console.error(String(error));
    console.error('워커가 도는 기계에서 실행하거나 --dir로 경로를 지정하세요.');
    process.exit(1);
    return;
  }

  const items = projectCatalog(raw);
  if (items.length === 0) {
    console.error(`카탈로그에 항목이 없습니다: ${from} — 커밋본을 비우지 않고 멈춥니다.`);
    process.exit(1);
    return;
  }

  const body = {
    note: 'scripts/sync-preset-catalog.ts가 생성합니다. 손으로 고치지 마세요.',
    source: 'character-clipart-library/assets/catalog.json',
    items,
  };
  await writeFile(OUT, `${JSON.stringify(body, null, 2)}\n`, 'utf8');

  const ready = items.filter((i) => i.status === 'ready').length;
  console.log(`${from}`);
  console.log(`→ ${OUT}`);
  console.log(`항목 ${items.length}건 (ready ${ready}건). 이 파일을 커밋하세요.`);
}

if (process.argv[1] && process.argv[1].endsWith('sync-preset-catalog.ts')) {
  void main();
}
