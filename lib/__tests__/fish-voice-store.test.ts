import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listFishVoices, upsertFishVoice } from '../fish-voice-store';
import { store } from '../store';

const voice = (id: string, ownerId: string) => ({
  id, ownerId, name: `${ownerId}의 목소리`, language: 'ko', sampleCount: 1,
  createdAt: '2026-08-26T00:00:00Z',
});

/** 저장소는 `vitest.setup.ts`가 테스트마다 새 `STORE_DIR`을 주므로 따로 비울 것이 없다. */

describe('listFishVoices', () => {
  it('returns the voices that student cloned', async () => {
    await upsertFishVoice(voice('v1', 'u1'));
    await upsertFishVoice(voice('v2', 'u1'));
    expect((await listFishVoices('u1')).map((v) => v.id).sort()).toEqual(['v1', 'v2']);
  });

  /**
   * 클론한 목소리는 개인 정보다. 이 필터가 사라지면 모든 수강생의 피커에
   * 남의 목소리가 뜨고, 그 id로 남의 목소리 릴스를 만들 수 있다.
   */
  it("never returns another student's voice", async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    await upsertFishVoice(voice('theirs', 'u2'));
    expect((await listFishVoices('u1')).map((v) => v.id)).toEqual(['mine']);
    expect((await listFishVoices('u2')).map((v) => v.id)).toEqual(['theirs']);
  });

  it('is empty for a student who has cloned nothing', async () => {
    await upsertFishVoice(voice('theirs', 'u2'));
    expect(await listFishVoices('u1')).toEqual([]);
  });

  it('returns nothing for a blank owner rather than everything', async () => {
    await upsertFishVoice(voice('theirs', 'u2'));
    expect(await listFishVoices('')).toEqual([]);
  });
});

describe('upsertFishVoice', () => {
  it('replaces a voice with the same id instead of duplicating it', async () => {
    await upsertFishVoice(voice('v1', 'u1'));
    await upsertFishVoice({ ...voice('v1', 'u1'), name: '새 이름' });
    const mine = await listFishVoices('u1');
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('새 이름');
  });

  it('keeps voices belonging to other students', async () => {
    await upsertFishVoice(voice('theirs', 'u2'));
    await upsertFishVoice(voice('mine', 'u1'));
    expect(await listFishVoices('u2')).toHaveLength(1);
  });
});

/**
 * 예전에는 이 모듈이 `.local-data`에 직접 파일을 썼다. Vercel에서는 그 경로가 읽기 전용이라
 * 클론이 조용히 실패했다. `store` 인터페이스를 타야 배포 저장소로 갈아끼울 수 있다.
 */
describe('storage backend', () => {
  it('writes through the store, into STORE_DIR rather than the repo .local-data', async () => {
    await upsertFishVoice(voice('v1', 'u1'));
    const written = JSON.parse(
      await readFile(path.join(process.env.STORE_DIR as string, 'fish-voices', 'u1.json'), 'utf8'),
    );
    expect(written).toEqual([voice('v1', 'u1')]);
  });

  it('reads what the store holds under that student key', async () => {
    await store.write('fish-voices/u1', [voice('seeded', 'u1')]);
    expect((await listFishVoices('u1')).map((v) => v.id)).toEqual(['seeded']);
  });
});

/**
 * 이 Task의 요점. 옛 구조에서는 목소리 전체가 배열 하나에 있어서, 두 수강생이 같은 순간에
 * 클론하면 나중에 쓴 쪽이 앞선 쪽을 지웠다.
 */
describe('fish voice keys – 소유자별 키', () => {
  it('keeps both voices when two students clone at the same time', async () => {
    await Promise.all([
      upsertFishVoice(voice('mine', 'u1')),
      upsertFishVoice(voice('theirs', 'u2')),
    ]);
    expect((await listFishVoices('u1')).map((v) => v.id)).toEqual(['mine']);
    expect((await listFishVoices('u2')).map((v) => v.id)).toEqual(['theirs']);
  });

  it('writes each student to their own key', async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    expect(await store.read('fish-voices/u1', [])).toHaveLength(1);
    expect(await store.read('fish-voices', null)).toBeNull();
  });

  // 소유권 경계는 이번 변경으로도 그대로여야 한다.
  it('still shows a student nothing of another student', async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    expect(await listFishVoices('u2')).toEqual([]);
  });

  /**
   * 필터가 **두 번째 겹**이라는 것을 직접 눌러 본다. 키가 이미 소유자를 나누므로 이 검사가
   * 없으면 필터를 지워도 아무것도 실패하지 않는다 — 그러면 언젠가 "이제 중복"이라며
   * 지워지고, 그 뒤 키 구조를 바꾸는 사람은 경계가 열리는 걸 못 본다.
   */
  it("drops a foreign-owned record that somehow sits in this student's key", async () => {
    await store.write('fish-voices/u1', [voice('mine', 'u1'), voice('theirs', 'u2')]);
    expect((await listFishVoices('u1')).map((v) => v.id)).toEqual(['mine']);
  });

  /**
   * 빈 소유자는 저장소를 **읽지 않는다**. 선가드가 없으면 빈 문자열이 그대로 키가 되고
   * (`fish-voices/`), 그 자리에 있는 것은 소유자 필터마저 통과한다(`'' === ''`). 그때 빈 세션 하나가
   * 전부를 보게 된다 — 선가드가 지워져도 아무것도 실패하지 않으면 언젠가 지워진다.
   */
  it('reads no key at all for a blank owner', async () => {
    await store.write('fish-voices/', [voice('orphan', '')]);
    expect(await listFishVoices('')).toEqual([]);
  });
});
