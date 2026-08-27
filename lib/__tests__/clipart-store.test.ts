import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { addStudentClipart, listStudentClipart, catalogFor } from '../clipart-store';

function seedPreset(entries: { keyword: string; aliases: string[] }[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'clipart-preset-'));
  mkdirSync(path.join(dir, 'assets', 'clipart'), { recursive: true });
  writeFileSync(path.join(dir, 'assets', 'catalog.json'), JSON.stringify({
    items: entries.map((e) => ({
      keyword: e.keyword, aliases: e.aliases, category: '감정',
      file: `assets/clipart/${e.keyword}.png`, status: 'ready',
    })),
  }));
  process.env.CLIPART_PRESET_DIR = dir;
}

beforeEach(() => seedPreset([{ keyword: '걱정', aliases: ['불안'] }]));

describe('listStudentClipart', () => {
  it('starts empty for a new student', async () => {
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  it('returns only the caller own clipart', async () => {
    await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    await addStudentClipart({ ownerId: 'u2', keyword: '슬픔', aliases: [], category: '감정', file: 'clipart/b.png' });
    const mine = await listStudentClipart('u1');
    expect(mine.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  it('marks stored entries as student source', async () => {
    const saved = await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
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
    await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    const { entries, usingPreset } = await catalogFor('u1');
    expect(usingPreset).toBe(false);
    expect(entries.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  it('reports an empty catalog when there is no preset either', async () => {
    process.env.CLIPART_PRESET_DIR = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
    const { entries, usingPreset } = await catalogFor('u1');
    expect(entries).toEqual([]);
    expect(usingPreset).toBe(true);
  });
});

/**
 * 여기부터는 브리프 밖에서 덧붙인 검사다. 소유권 경계와 저장소 경유는 목소리
 * (`lib/fish-voice-store.ts`)와 같은 규칙이라 같은 자리에서 눌러 본다.
 */
describe('clipart ownership – 경계', () => {
  it('returns nothing for a blank owner rather than everything', async () => {
    await addStudentClipart({ ownerId: 'u2', keyword: '슬픔', aliases: [], category: '감정', file: 'clipart/b.png' });
    expect(await listStudentClipart('')).toEqual([]);
  });

  // 빈 ownerId로 catalogFor를 부르면 "가진 게 없는 수강생"과 구별되지 않는다.
  // 프리셋으로 떨어지는 게 맞다 — 남의 것을 보여 주는 것보다 안전하다.
  it('falls back to the preset for a blank owner instead of leaking someone else', async () => {
    await addStudentClipart({ ownerId: 'u2', keyword: '슬픔', aliases: [], category: '감정', file: 'clipart/b.png' });
    const { entries, usingPreset } = await catalogFor('');
    expect(usingPreset).toBe(true);
    expect(entries.map((e) => e.keyword)).not.toContain('슬픔');
  });

  it("never mixes another student's clipart into the caller catalog", async () => {
    await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    await addStudentClipart({ ownerId: 'u2', keyword: '슬픔', aliases: [], category: '감정', file: 'clipart/b.png' });
    const { entries } = await catalogFor('u1');
    expect(entries.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  it('gives two students different ids for the same keyword', async () => {
    const mine = await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    const theirs = await addStudentClipart({ ownerId: 'u2', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/b.png' });
    // 같은 id면 `clipartAssetKey`가 같은 자리를 내주고, 한 사람의 그림이 다른 사람 것을 덮는다.
    expect(mine.id).not.toBe(theirs.id);
  });

  it('keeps earlier uploads when a new one arrives', async () => {
    await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    await addStudentClipart({ ownerId: 'u1', keyword: '슬픔', aliases: [], category: '감정', file: 'clipart/b.png' });
    // 순서도 박아 둔다. `matchClipart`는 동점일 때 앞선 항목을 고르므로, 나중에 올린 것이
    // 앞으로 끼어들면 같은 대본이 다른 그림을 낸다.
    expect((await listStudentClipart('u1')).map((e) => e.keyword)).toEqual(['기쁨', '슬픔']);
  });
});

/**
 * 예전에 `fish-voice-store`가 `.local-data`에 직접 파일을 써서 Vercel(읽기 전용 FS)에서
 * 조용히 실패했다. 같은 고장을 반복하지 않도록 `store`를 타는지 확인한다.
 */
describe('storage backend', () => {
  it('writes through the store, into STORE_DIR rather than the repo .local-data', async () => {
    const saved = await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: ['행복'], category: '감정', file: 'clipart/a.png' });
    const written = JSON.parse(
      await readFile(path.join(process.env.STORE_DIR as string, 'clipart-library.json'), 'utf8'),
    );
    expect(written).toEqual([saved]);
  });
});
