/**
 * 옛 배열 키에 남아 있는 데이터를 Task 2~5가 만든 **키별 자리**로 옮긴다.
 *
 *   npx tsx scripts/shard-store.ts
 *   BLOB_READ_WRITE_TOKEN=<토큰> npx tsx scripts/shard-store.ts   # 배포 저장소
 *
 * 왜 필요한가. 키를 나눈 뒤로는 아무도 옛 배열 키를 읽지 않는다. 그러니 이전을 하지 않으면
 * 사용자의 프로젝트·잡·목소리·캐릭터·학습 기록이 **앱 입장에서는 전부 사라진 것**이 된다.
 * 파일은 멀쩡히 거기 있는데 화면은 비어 있는, 가장 알아채기 어려운 종류의 고장이다.
 *
 * 세 가지를 지킨다.
 *
 * 1. **옛 키를 지우지도 비우지도 않는다.** 이 스크립트가 틀렸을 때 되돌릴 것이 남아 있어야
 *    한다. 남겨 두는 것이 두 번째 실행을 안전하게 만드는 이유이기도 하다.
 * 2. **두 번 돌려도 같다.** 이미 자리에 있는 것은 덮지 않고 세기만 한다. 사람은 언젠가
 *    두 번 돌린다.
 * 3. **주인을 지어내지 않는다.** 소유자를 알 수 없는 기록은 `__legacy__`에 모은다.
 *    아무 수강생 세션도 그 자리를 읽지 않으므로 아무에게도 보이지 않고, 없어지지도 않는다.
 *
 * **레코드를 고치지 않는다.** 옮기는 것이지 다시 쓰는 것이 아니다. 소유자를 모르는 기록에
 * `ownerId: '__legacy__'`를 찍어 넣지도 않는다 — 키는 "우리가 아는 것"을 적는 자리이고
 * 레코드는 있던 그대로여야 한다. 덤으로 `listFishVoices`·`listStudentClipart`·`readOwned`의
 * `ownerId` 필터가 한 겹 더 남는다.
 */
import { selectStore } from '../lib/store';
import type { JobIndexEntry, RenderJob } from '../lib/jobs';

/** 소유자를 알 수 없는 기록이 모이는 자리. 어떤 세션의 id도 될 수 없는 값이다. */
export const LEGACY_OWNER = '__legacy__';

export interface ShardReport {
  /** 옛 키별로 **새로 쓴** 레코드 수. 옛 키가 비어 있었으면 0으로 나온다(건너뜀과 다르다). */
  moved: Record<string, number>;
  /** 옛 키가 아예 없어 손대지 않은 키. 이미 이전됐거나 처음부터 없던 키다. */
  skipped: string[];
  /** 새 자리에 이미 있어 덮지 않은 레코드 수. 두 번째 실행이면 전부 여기로 온다. */
  alreadyThere: Record<string, number>;
  /** 소유자를 알 수 없어 `__legacy__`로 모은 레코드 수. */
  legacy: Record<string, number>;
  /** 쓸 수 있는 `id`가 없어 옮길 자리를 정하지 못한 레코드 수. 옛 키에 그대로 있다. */
  unkeyed: Record<string, number>;
}

/**
 * 키 한 조각으로 쓸 수 있는 값인지 본다. `../`나 `/`가 들어오면 저장소 바깥 파일을 읽고
 * 쓰게 되므로(`assertSafeStoreKey`), 그런 값은 조각으로 쓰지 않는다.
 */
function usableSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.includes('/') || trimmed.startsWith('.')) return null;
  return trimmed;
}

/**
 * 레코드의 소유자를 키 조각으로 바꾼다.
 *
 * 비었거나 없거나 키를 벗어나는 값이면 `__legacy__`다. **아무 수강생에게도 배정하지 않는다** —
 * Task 5가 닫은 누출이 바로 "남의 기록이 내 자리에서 읽히는 것"이었고, 여기서 주인을
 * 짐작하는 순간 그 누출이 그대로 되살아난다. 모르는 것은 모르는 자리에 둔다.
 */
function ownerSegment(value: unknown): string {
  return usableSegment(value) ?? LEGACY_OWNER;
}

/** 자기 키를 갖는 레코드의 id. 없거나 키를 벗어나면 `null`이고, 그 레코드는 옮기지 않는다. */
function idOf(record: Record<string, unknown>): string | null {
  return usableSegment(record.id);
}

/** 모르는 모양이면 멈춘다. 반쯤 된 이전은 아예 안 한 것보다 나쁘다. */
function expectArray(value: unknown, key: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new Error(`\`${key}\`가 배열이 아닙니다. 손대지 않고 멈춥니다: ${typeof value}`);
  }
  return value as Record<string, unknown>[];
}

export async function shardStore(): Promise<ShardReport> {
  const store = selectStore();
  const report: ShardReport = { moved: {}, skipped: [], alreadyThere: {}, legacy: {}, unkeyed: {} };

  /**
   * fallback이 `null`인 것이 핵심이다. `[]`로 읽으면 "키가 없다"와 "키가 비었다"가 똑같이
   * 빈 배열로 보이고, 그러면 보고에서 둘을 구분할 수 없다 — 확인하는 사람에게는 "0건 옮김"과
   * "아직 안 봤음"이 전혀 다른 소식이다.
   */
  async function readOldKey(key: string): Promise<Record<string, unknown>[] | null> {
    const raw = await store.read<unknown>(key, null);
    if (raw === null || raw === undefined) {
      report.skipped.push(key);
      return null;
    }
    return expectArray(raw, key);
  }

  /** 이미 그 자리에 값이 있는지. 있으면 덮지 않는다 — 분리 뒤 진행된 값이 더 최신이다. */
  async function occupied(key: string): Promise<boolean> {
    return (await store.read<unknown>(key, null)) !== null;
  }

  /**
   * `projects`·`jobs`처럼 **레코드마다 자기 키**를 갖는 옛 키를 옮긴다.
   * 새 prefix가 옛 키 이름과 같다(`projects` → `projects/<id>`).
   */
  async function shardById(key: string, records: Record<string, unknown>[]): Promise<string[]> {
    let moved = 0;
    let already = 0;
    let unkeyed = 0;
    const ids: string[] = [];

    for (const record of records) {
      const id = idOf(record);
      if (!id) {
        unkeyed += 1;
        continue;
      }
      ids.push(id);
      if (await occupied(`${key}/${id}`)) {
        already += 1;
        continue;
      }
      await store.write(`${key}/${id}`, record);
      moved += 1;
    }

    report.moved[key] = moved;
    report.alreadyThere[key] = already;
    report.unkeyed[key] = unkeyed;
    return ids;
  }

  /**
   * `job-index`를 **옮겨진 잡에서** 만든다. 항목 모양은 `lib/jobs.ts`의 `JobIndexEntry`
   * 그대로다 — 타입을 그쪽에서 가져오므로 필드가 늘면 여기서 컴파일이 깨진다.
   *
   * 정본은 `jobs/<id>`이므로 옛 배열이 아니라 **옮겨진 잡을 다시 읽어** 항목을 만든다.
   * 이미 인덱스에 있는 항목은 건드리지 않는다. 그쪽이 살아 있는 값이고, 옛 배열은 멈춘 값이다.
   */
  async function buildJobIndex(ids: string[]): Promise<void> {
    const existing = expectArray(await store.read<unknown>('job-index', []), 'job-index');
    const known = new Set(existing.map((entry) => entry.id));

    const added: JobIndexEntry[] = [];
    for (const id of ids) {
      if (known.has(id)) continue;
      const job = await store.read<RenderJob | null>(`jobs/${id}`, null);
      if (!job) continue;
      added.push({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        claimedAt: job.claimedAt ?? null,
      });
      known.add(id);
    }

    if (added.length) await store.write('job-index', [...existing, ...added]);
    report.moved['job-index'] = added.length;
    report.alreadyThere['job-index'] = ids.length - added.length;
  }

  /**
   * `fish-voices`·`clipart-library`·`learning-records`처럼 **소유자당 배열 하나**가 되는 옛 키.
   *
   * 이미 있는 항목 뒤에 덧붙인다(앞이 아니라). `matchClipart`는 동점일 때 앞선 항목을 고르므로
   * 순서를 흔들면 이 이전과 무관한 대본의 결과까지 바뀐다.
   *
   * `id`로 겹치는지 본다 — 그래서 두 번 돌려도 늘어나지 않고, 이전 뒤에 생긴 항목도 지워지지
   * 않는다. `id`가 없으면 겹침을 판단할 방법이 없으므로 옮기지 않고 보고만 한다.
   */
  async function shardByOwnerList(key: string, records: Record<string, unknown>[]): Promise<void> {
    const groups = new Map<string, Record<string, unknown>[]>();
    let legacy = 0;
    let unkeyed = 0;

    for (const record of records) {
      if (!idOf(record)) {
        unkeyed += 1;
        continue;
      }
      const owner = ownerSegment(record.ownerId);
      if (owner === LEGACY_OWNER) legacy += 1;
      const group = groups.get(owner);
      if (group) group.push(record);
      else groups.set(owner, [record]);
    }

    let moved = 0;
    let already = 0;
    // `Array.from`으로 도는 이유는 취향이 아니다. tsconfig의 target이 es5라 Map을 직접
    // 순회하면 컴파일이 깨진다. 소유자 id가 `__proto__`여도 안전하도록 Map은 유지한다.
    for (const [owner, items] of Array.from(groups.entries())) {
      const target = `${key}/${owner}`;
      const existing = expectArray(await store.read<unknown>(target, []), target);
      const have = new Set(existing.map((entry) => entry.id));
      const toAdd = items.filter((item) => !have.has(item.id));

      already += items.length - toAdd.length;
      if (toAdd.length) {
        await store.write(target, [...existing, ...toAdd]);
        moved += toAdd.length;
      }
    }

    report.moved[key] = moved;
    report.alreadyThere[key] = already;
    report.legacy[key] = legacy;
    report.unkeyed[key] = unkeyed;
  }

  /**
   * `style-sheets`만 모양이 다르다. 새 자리에는 **배열이 아니라 시트 하나**가 들어간다
   * (`lib/style-sheet.ts`) — 한 사람에게 시트는 하나뿐이기 때문이다.
   *
   * 그래서 여기서 세는 `moved`는 레코드 수가 아니라 **쓴 소유자 키 수**다. 옛 배열에 한
   * 소유자의 시트가 둘 이상 있었다면 마지막 것만 남고 그만큼 수가 어긋난다 — 확인하는
   * 사람이 알아채야 하는 어긋남이므로 감추지 않는다. 옛 키는 그대로이니 잃은 것은 없다.
   */
  async function shardStyleSheets(records: Record<string, unknown>[]): Promise<void> {
    const byOwner = new Map<string, Record<string, unknown>>();
    for (const record of records) byOwner.set(ownerSegment(record.ownerId), record);

    let moved = 0;
    let already = 0;
    for (const [owner, sheet] of Array.from(byOwner.entries())) {
      const target = `style-sheets/${owner}`;
      if (await occupied(target)) {
        already += 1;
        continue;
      }
      await store.write(target, sheet);
      moved += 1;
    }

    report.moved['style-sheets'] = moved;
    report.alreadyThere['style-sheets'] = already;
    report.legacy['style-sheets'] = byOwner.has(LEGACY_OWNER) ? 1 : 0;
    report.unkeyed['style-sheets'] = 0;
  }

  const projects = await readOldKey('projects');
  if (projects) await shardById('projects', projects);

  const jobs = await readOldKey('jobs');
  if (jobs) await buildJobIndex(await shardById('jobs', jobs));

  const styleSheets = await readOldKey('style-sheets');
  if (styleSheets) await shardStyleSheets(styleSheets);

  for (const key of ['fish-voices', 'clipart-library', 'learning-records']) {
    const records = await readOldKey(key);
    if (records) await shardByOwnerList(key, records);
  }

  // `students`는 그대로다. 나뉜 키가 아니라 로그인이 읽는 목록 하나이므로 옮길 것이 없다.
  return report;
}

async function main() {
  const store = selectStore();
  const report = await shardStore();

  console.log(`저장소: ${store.kind}`);
  for (const key of Object.keys(report.moved)) {
    console.log(
      `${key.padEnd(17)} 옮김 ${report.moved[key]}건` +
        ` · 이미 있음 ${report.alreadyThere[key] ?? 0}건` +
        ` · 주인 모름 ${report.legacy[key] ?? 0}건` +
        ` · id 없음 ${report.unkeyed[key] ?? 0}건`,
    );
  }
  console.log(`건너뜀(옛 키 없음): ${report.skipped.join(', ') || '없음'}`);
  console.log(
    `\n옛 키는 지우지 않았습니다. 위 건수가 옛 파일의 건수와 다르면 되돌릴 수 있습니다.` +
      `\n주인 모를 기록은 \`${LEGACY_OWNER}\`에 있습니다 — 아무 수강생에게도 보이지 않습니다.`,
  );
}

// 임포트(테스트)로 불릴 때는 실행하지 않는다.
if (process.argv[1] && process.argv[1].endsWith('shard-store.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
