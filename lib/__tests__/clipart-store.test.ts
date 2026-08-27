import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { addStudentClipart, listStudentClipart, catalogFor, newClipartId } from '../clipart-store';
import { PRESET_OWNER_ID } from '../clipart-preset';
import type { ClipartEntry } from '../clipart';
import { store } from '../store';

/**
 * 프리셋 카탈로그를 여기서 직접 정한다. **실측 카탈로그(104건)를 그대로 쓰면 이 파일의
 * 검사가 운영자가 캐릭터를 하나 추가할 때마다 흔들린다** — 여기서 볼 것은 카탈로그의 내용이
 * 아니라 `catalogFor`의 경계(내 것이 있으면 프리셋을 섞지 않는다)이기 때문이다.
 *
 * 커밋된 실제 카탈로그가 이 경로를 타고 앱·워커 양쪽에 같은 모양으로 도착하는지는
 * `lib/__tests__/preset-catalog-agreement.test.ts`가 모의 없이 확인한다.
 */
const preset = vi.hoisted(() => ({ entries: [] as unknown[] }));

vi.mock('../clipart-preset', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clipart-preset')>()),
  loadPresetClipart: () => Promise.resolve(preset.entries),
}));

function seedPreset(entries: { keyword: string; aliases: string[] }[]) {
  preset.entries = entries.map((e): ClipartEntry => ({
    id: `preset:${e.keyword}`, ownerId: PRESET_OWNER_ID, keyword: e.keyword,
    aliases: e.aliases, category: '감정', source: 'preset',
    file: `assets/clipart/${e.keyword}.png`,
  }));
}

/**
 * 업로드 라우트(Task 3)와 같은 순서를 흉내 낸다: id를 먼저 만들고 → 그 id로 그림을 올리고
 * → 그 결과 경로를 `file`로 넘겨 한 번만 저장한다. `id`가 저장 함수 안에서 만들어지면
 * "id를 얻으려면 저장해야 하는데 저장하려면 file이 필요하고 file을 얻으려면 id가 필요한"
 * 순환이 생긴다.
 */
const upload = (ownerId: string, keyword: string, file: string, aliases: string[] = []) => ({
  id: newClipartId(), ownerId, keyword, aliases, category: '감정', file,
});

beforeEach(() => seedPreset([{ keyword: '걱정', aliases: ['불안'] }]));

describe('listStudentClipart', () => {
  it('starts empty for a new student', async () => {
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  it('returns only the caller own clipart', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    await addStudentClipart(upload('u2', '슬픔', 'clipart/b.png'));
    const mine = await listStudentClipart('u1');
    expect(mine.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  it('marks stored entries as student source', async () => {
    const saved = await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    expect(saved.source).toBe('student');
    expect(saved.id).toBeTruthy();
  });
});

describe('catalogFor', () => {
  it('falls back to the operator preset when the student has none', async () => {
    const { entries, usingPreset } = await catalogFor('u1');
    expect(usingPreset).toBe(true);
    expect(entries.map((e) => e.keyword)).toContain('걱정');
    expect(entries.every((e) => e.source === 'preset')).toBe(true);
  });

  // 자기 것이 하나라도 있으면 프리셋을 섞지 않는다. 섞으면 자기 캐릭터와 남의 캐릭터가
  // 한 영상에 같이 나온다.
  it('uses only the student clipart once they have any', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    const { entries, usingPreset } = await catalogFor('u1');
    expect(usingPreset).toBe(false);
    expect(entries.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  // `usingPreset`의 뜻은 "내 것이 아니다"이지 "프리셋이 실제로 들어 있다"가 아니다.
  // 프리셋이 비어도 안내는 떠야 한다 — 그래야 수강생이 발행 전에 알아챈다.
  it('reports an empty catalog when there is no preset either', async () => {
    seedPreset([]);
    const { entries, usingPreset } = await catalogFor('u1');
    expect(entries).toEqual([]);
    expect(usingPreset).toBe(true);
  });
});

/**
 * `newClipartId`가 따로 있는 이유는 업로드 순환을 끊기 위해서다. 그러니 이 함수에 대해
 * 지켜야 할 성질은 하나다: **절대 겹치지 않는다.** 겹치면 `clipartAssetKey`가 같은 자리를
 * 내주고, 한 수강생의 그림이 다른 수강생 것을 덮는다.
 */
describe('newClipartId', () => {
  it('never collides across calls', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newClipartId()));
    expect(ids.size).toBe(1000);
  });

  it('needs no store, so the route can mint an id before it uploads anything', () => {
    // 저장소를 건드리지 않는다는 뜻이다 — 동기 함수이고 아무것도 await하지 않는다.
    expect(newClipartId()).toMatch(/^clipart_[0-9a-f-]{36}$/);
  });
});

/**
 * 여기부터는 브리프 밖에서 덧붙인 검사다. 소유권 경계와 저장소 경유는 목소리
 * (`lib/fish-voice-store.ts`)와 같은 규칙이라 같은 자리에서 눌러 본다.
 */
describe('clipart ownership – 경계', () => {
  it('returns nothing for a blank owner rather than everything', async () => {
    await addStudentClipart(upload('u2', '슬픔', 'clipart/b.png'));
    expect(await listStudentClipart('')).toEqual([]);
  });

  // 빈 ownerId로 catalogFor를 부르면 "가진 게 없는 수강생"과 구별되지 않는다.
  // 프리셋으로 떨어지는 게 맞다 — 남의 것을 보여 주는 것보다 안전하다.
  it('falls back to the preset for a blank owner instead of leaking someone else', async () => {
    await addStudentClipart(upload('u2', '슬픔', 'clipart/b.png'));
    const { entries, usingPreset } = await catalogFor('');
    expect(usingPreset).toBe(true);
    expect(entries.map((e) => e.keyword)).not.toContain('슬픔');
  });

  it("never mixes another student's clipart into the caller catalog", async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    await addStudentClipart(upload('u2', '슬픔', 'clipart/b.png'));
    const { entries } = await catalogFor('u1');
    expect(entries.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  it('keeps earlier uploads when a new one arrives', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    await addStudentClipart(upload('u1', '슬픔', 'clipart/b.png'));
    // 순서도 박아 둔다. `matchClipart`는 동점일 때 앞선 항목을 고르므로, 나중에 올린 것이
    // 앞으로 끼어들면 같은 대본이 다른 그림을 낸다.
    expect((await listStudentClipart('u1')).map((e) => e.keyword)).toEqual(['기쁨', '슬픔']);
  });
});

/**
 * 같은 키워드를 다시 올리는 것은 **고치는 행위다.** 덧붙이면 같은 키워드 항목이 둘 남고,
 * `matchClipart`는 동점일 때 앞선 항목을 고르므로 새 그림이 절대 이기지 못한다 — 수강생
 * 눈에는 "다시 올렸는데 안 바뀐다"가 되고 잘못된 키워드를 고칠 길이 막힌다.
 */
describe('addStudentClipart – 같은 키워드 다시 올리기', () => {
  it('replaces the entry instead of adding a second one with the same keyword', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/old.png'));
    await addStudentClipart(upload('u1', '기쁨', 'clipart/new.png'));

    const mine = await listStudentClipart('u1');
    expect(mine).toHaveLength(1);
    expect(mine[0].file).toBe('clipart/new.png');
  });

  /**
   * id는 새것이어야 한다. `clipartAssetKey`가 id를 해싱하므로 새 id면 새 그림이 **새 자리**에
   * 올라가고 옛 그림은 아무도 안 보는 채로 남는다. id를 재사용해 같은 자리를 덮으면 지금
   * 진행 중인 렌더가 가져가는 중인 파일을 갈아 끼우게 된다.
   */
  it('carries the new id, so the new image lives at a new key and no in-flight render is mutated', async () => {
    const first = upload('u1', '기쁨', 'clipart/old.png');
    const second = upload('u1', '기쁨', 'clipart/new.png');
    expect(second.id).not.toBe(first.id);

    await addStudentClipart(first);
    await addStudentClipart(second);

    expect((await listStudentClipart('u1'))[0].id).toBe(second.id);
  });

  // 소유자까지 함께 봐야 한다. 키워드만 보면 u1이 `기쁨`을 올릴 때 u2의 `기쁨`이 사라진다.
  it("never replaces another student's entry that happens to share the keyword", async () => {
    await addStudentClipart(upload('u2', '기쁨', 'clipart/theirs.png'));
    await addStudentClipart(upload('u1', '기쁨', 'clipart/mine.png'));

    expect((await listStudentClipart('u2')).map((e) => e.file)).toEqual(['clipart/theirs.png']);
    expect((await listStudentClipart('u1')).map((e) => e.file)).toEqual(['clipart/mine.png']);
  });

  /**
   * 자리를 지킨다. `matchClipart`는 동점일 때 앞선 항목을 고르므로, 갈아 끼우며 뒤로 밀면
   * 이 항목과 무관한 다른 대본의 결과까지 흔들린다. 갈아 끼우는 건 그림이지 순서가 아니다.
   */
  it('keeps the entry in place rather than moving it to the end', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    await addStudentClipart(upload('u1', '슬픔', 'clipart/b.png'));
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a2.png'));

    expect((await listStudentClipart('u1')).map((e) => e.keyword)).toEqual(['기쁨', '슬픔']);
  });

  // 다른 키워드는 여전히 덧붙는다. 갈아 끼우기가 "하나만 가질 수 있다"가 되면 안 된다.
  it('still appends when the keyword is new', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    await addStudentClipart(upload('u1', '슬픔', 'clipart/b.png'));
    expect(await listStudentClipart('u1')).toHaveLength(2);
  });
});

describe('addStudentClipart – 호출자가 정하는 것과 정하지 못하는 것', () => {
  it('stores the caller minted id unchanged', async () => {
    // 라우트는 이 id로 계산한 자리에 그림을 이미 올려 뒀다. 저장하며 바꾸면 그림을 잃는다.
    const entry = upload('u1', '기쁨', 'clipart/a.png');
    expect((await addStudentClipart(entry)).id).toBe(entry.id);
    expect((await listStudentClipart('u1'))[0].id).toBe(entry.id);
  });

  it('forces student source even when the caller claims otherwise', async () => {
    // 타입으로도 막지만(`Omit<…, 'source'>`), 런타임 값은 FormData에서 온다.
    // `preset`으로 들어오면 렌더가 원본을 프리셋 디렉터리에서 찾다 실패해 그림이 사라진다.
    const sneaky = { ...upload('u1', '기쁨', 'clipart/a.png'), source: 'preset' };
    expect((await addStudentClipart(sneaky)).source).toBe('student');
  });
});

/**
 * 예전에 `fish-voice-store`가 `.local-data`에 직접 파일을 써서 Vercel(읽기 전용 FS)에서
 * 조용히 실패했다. 같은 고장을 반복하지 않도록 `store`를 타는지 확인한다.
 */
describe('storage backend', () => {
  it('writes through the store, into STORE_DIR rather than the repo .local-data', async () => {
    const saved = await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png', ['행복']));
    const written = JSON.parse(
      await readFile(
        path.join(process.env.STORE_DIR as string, 'clipart-library', 'u1.json'), 'utf8',
      ),
    );
    expect(written).toEqual([saved]);
  });
});

/**
 * 이 Task의 요점. 옛 구조에서는 모든 수강생의 클립아트가 배열 하나에 있어서, 둘이 같은
 * 순간에 올리면 나중에 쓴 쪽이 앞선 쪽을 지웠다.
 */
describe('clipart keys – 소유자별 키', () => {
  it('keeps both uploads when two students upload at the same time', async () => {
    await Promise.all([
      addStudentClipart(upload('u1', '기쁨', 'clipart/a.png')),
      addStudentClipart(upload('u2', '슬픔', 'clipart/b.png')),
    ]);
    expect((await listStudentClipart('u1')).map((e) => e.keyword)).toEqual(['기쁨']);
    expect((await listStudentClipart('u2')).map((e) => e.keyword)).toEqual(['슬픔']);
  });

  it('writes each student to their own key', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    expect(await store.read('clipart-library/u1', [])).toHaveLength(1);
    expect(await store.read('clipart-library', null)).toBeNull();
  });

  // 소유권 경계는 이번 변경으로도 그대로여야 한다.
  it('still shows a student nothing of another student', async () => {
    await addStudentClipart(upload('u1', '기쁨', 'clipart/a.png'));
    expect(await listStudentClipart('u2')).toEqual([]);
  });

  /**
   * 필터가 **두 번째 겹**이라는 것을 직접 눌러 본다. 키가 이미 소유자를 나누므로 이 검사가
   * 없으면 필터를 지워도 아무것도 실패하지 않는다 — 그러면 언젠가 "이제 중복"이라며
   * 지워지고, 그 뒤 키 구조를 바꾸는 사람은 경계가 열리는 걸 못 본다.
   */
  it("drops a foreign-owned record that somehow sits in this student's key", async () => {
    await store.write('clipart-library/u1', [
      { ...upload('u1', '기쁨', 'clipart/a.png'), source: 'student' },
      { ...upload('u2', '슬픔', 'clipart/b.png'), source: 'student' },
    ]);
    expect((await listStudentClipart('u1')).map((e) => e.keyword)).toEqual(['기쁨']);
  });

  /**
   * upsert의 소유자 검사도 같은 이유로 눌러 본다. `findIndex`에서 `ownerId` 비교를 빼도
   * 어떤 테스트도 실패하지 않았다 — 위 필터가 그랬듯 두 번째 겹이 아무것에도 고정돼 있지
   * 않았다는 뜻이다. 주석(`lib/clipart-store.ts`)이 약속하는 보장이 정확히 이것이다:
   * **수강생 A가 `기쁨`을 올릴 때 B의 `기쁨`이 사라지지 않는다.**
   *
   * 키가 이미 소유자를 나누므로 남의 레코드가 내 키에 앉아 있는 상황을 일부러 만든다 —
   * 이전(`scripts/shard-store.ts`)이나 옛 데이터가 만들 수 있는 모양이고, 소유자 비교가
   * 사라지면 upsert가 그 레코드를 **갈아 끼워 없앤다.**
   */
  it("upserts over the caller's own entry, never a foreign one with the same keyword", async () => {
    const foreign = { ...upload('u2', '기쁨', 'clipart/theirs.png'), source: 'student' as const };
    await store.write('clipart-library/u1', [foreign]);

    const mine = await addStudentClipart(upload('u1', '기쁨', 'clipart/mine.png'));

    const stored = await store.read<ClipartEntry[]>('clipart-library/u1', []);
    // 소유자 비교가 없으면 `기쁨` 하나만 남고 그 하나가 u1의 것이다 — B의 그림이 사라진다.
    expect(stored).toHaveLength(2);
    expect(stored.find((e) => e.ownerId === 'u2')).toEqual(foreign);
    expect(stored.find((e) => e.ownerId === 'u1')?.file).toBe('clipart/mine.png');
    expect(mine.id).not.toBe(foreign.id);
  });

  /**
   * 빈 소유자는 저장소를 **읽지 않는다**. 선가드가 없으면 빈 문자열이 그대로 키가 되고
   * (`clipart-library/`), 그 자리에 있는 것은 소유자 필터마저 통과한다(`'' === ''`). 그때 빈 세션 하나가
   * 전부를 보게 된다 — 선가드가 지워져도 아무것도 실패하지 않으면 언젠가 지워진다.
   */
  it('reads no key at all for a blank owner', async () => {
    await store.write('clipart-library/', [{ ...upload('', '기쁨', 'a.png'), source: 'student' }]);
    expect(await listStudentClipart('')).toEqual([]);
  });
});
