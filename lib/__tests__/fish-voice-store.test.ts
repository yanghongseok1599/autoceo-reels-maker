import { describe, it, expect, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listFishVoices, upsertFishVoice, ownsFishVoice } from '../fish-voice-store';
import { store } from '../store';

const voice = (id: string, ownerId: string) => ({
  id, ownerId, name: `${ownerId}의 목소리`, language: 'ko', sampleCount: 1,
  createdAt: '2026-08-26T00:00:00Z',
});

beforeEach(async () => {
  await store.write('fish-voices', []);
});

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

describe('ownsFishVoice', () => {
  beforeEach(async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    await upsertFishVoice(voice('theirs', 'u2'));
  });

  it('accepts the owner', async () => {
    expect(await ownsFishVoice('u1', 'mine')).toBe(true);
  });

  it("rejects another student's voice", async () => {
    expect(await ownsFishVoice('u1', 'theirs')).toBe(false);
  });

  it('rejects an unknown voice id', async () => {
    expect(await ownsFishVoice('u1', 'nope')).toBe(false);
  });

  it('rejects a blank owner or voice id', async () => {
    expect(await ownsFishVoice('', 'mine')).toBe(false);
    expect(await ownsFishVoice('u1', '')).toBe(false);
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
      await readFile(path.join(process.env.STORE_DIR as string, 'fish-voices.json'), 'utf8'),
    );
    expect(written).toEqual([voice('v1', 'u1')]);
  });

  it('reads what the store holds under the shared key', async () => {
    await store.write('fish-voices', [voice('seeded', 'u1')]);
    expect((await listFishVoices('u1')).map((v) => v.id)).toEqual(['seeded']);
  });
});
