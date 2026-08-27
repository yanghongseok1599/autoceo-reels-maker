import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyClipart } from '../render';
import { clipartAssetKey, type ClipartEntry } from '@/lib/clipart';

let publicDir: string;
const entry: ClipartEntry = {
  id: 'c1', ownerId: 'u1', keyword: '걱정', aliases: [],
  category: '감정', source: 'preset', file: 'assets/clipart/걱정.png',
};

beforeEach(() => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'clipart-src-'));
  mkdirSync(path.join(source, 'assets', 'clipart'), { recursive: true });
  writeFileSync(path.join(source, entry.file), 'PNGDATA');
  process.env.CLIPART_PRESET_DIR = source;
  publicDir = mkdtempSync(path.join(os.tmpdir(), 'clipart-pub-'));
});

describe('copyClipart', () => {
  it('copies a preset image under its ascii-safe key', async () => {
    await copyClipart([entry], publicDir);
    expect(existsSync(path.join(publicDir, clipartAssetKey(entry)))).toBe(true);
  });

  it('copies the bytes, not an empty placeholder', async () => {
    await copyClipart([entry], publicDir);
    expect(readFileSync(path.join(publicDir, clipartAssetKey(entry)), 'utf8')).toBe('PNGDATA');
  });

  it('does nothing for an empty list', async () => {
    await expect(copyClipart([], publicDir)).resolves.toBeUndefined();
  });

  // 캐릭터가 없다고 렌더 전체가 죽으면 안 된다.
  it('skips a missing source instead of throwing', async () => {
    await expect(copyClipart([{ ...entry, file: 'assets/clipart/없음.png' }], publicDir))
      .resolves.toBeUndefined();
  });

  it('keeps copying the rest after one source is missing', async () => {
    await copyClipart([{ ...entry, id: 'c0', file: 'assets/clipart/없음.png' }, entry], publicDir);
    expect(existsSync(path.join(publicDir, clipartAssetKey(entry)))).toBe(true);
  });

  /**
   * 수강생 그림은 `publish`가 이미 도달 가능한 자리에 올려 뒀다. 여기서 또 복사하려 들면
   * 프리셋 디렉터리에서 `clipart/ab.png`를 찾다 실패할 뿐이고, 그 실패는 조용하다.
   */
  it('leaves a student image alone — publish already put it within reach', async () => {
    const student: ClipartEntry = { ...entry, id: 'c2', source: 'student', file: 'clipart/ab.png' };
    await copyClipart([student], publicDir);
    expect(existsSync(path.join(publicDir, clipartAssetKey(student)))).toBe(false);
  });
});
