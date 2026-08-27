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

  it('reports the key it wrote, so the caller can trust that one scene', async () => {
    await expect(copyClipart([entry], publicDir)).resolves.toEqual([clipartAssetKey(entry)]);
  });

  it('copies the bytes, not an empty placeholder', async () => {
    await copyClipart([entry], publicDir);
    expect(readFileSync(path.join(publicDir, clipartAssetKey(entry)), 'utf8')).toBe('PNGDATA');
  });

  it('does nothing for an empty list', async () => {
    await expect(copyClipart([], publicDir)).resolves.toEqual([]);
  });

  /**
   * **던지지 않는 것만으로는 부족하다.** 조용히 건너뛰고 끝내면 씬은 아무도 쓰지 않은
   * 파일을 계속 가리키고, 렌더러가 404를 재시도하다 렌더를 통째로 중단한다. 그래서 여기서
   * 확인할 것은 "resolve했다"가 아니라 **못 썼다고 보고했다**이다 — 그 보고가
   * `dropUncopiedCharacters`가 씬에서 캐릭터를 떼는 근거다.
   */
  it('reports a missing source as not copied, instead of throwing', async () => {
    await expect(copyClipart([{ ...entry, file: 'assets/clipart/없음.png' }], publicDir))
      .resolves.toEqual([]);
  });

  it('keeps copying the rest after one source is missing', async () => {
    const missing = { ...entry, id: 'c0', file: 'assets/clipart/없음.png' };
    await expect(copyClipart([missing, entry], publicDir))
      .resolves.toEqual([clipartAssetKey(entry)]);
    expect(existsSync(path.join(publicDir, clipartAssetKey(entry)))).toBe(true);
    expect(existsSync(path.join(publicDir, clipartAssetKey(missing)))).toBe(false);
  });

  /**
   * 수강생 그림은 `publish`가 이미 도달 가능한 자리에 올려 뒀다. 여기서 또 복사하려 들면
   * 프리셋 디렉터리에서 `clipart/ab.png`를 찾다 실패할 뿐이고, 그 실패는 조용하다.
   */
  it('leaves a student image alone — publish already put it within reach', async () => {
    const student: ClipartEntry = { ...entry, id: 'c2', source: 'student', file: 'clipart/ab.png' };
    // 복사 목록에 없는 것이 정상이다. 실패가 아니므로 씬에서 떼면 안 된다
    // (`dropUncopiedCharacters`가 프리셋만 본다).
    await expect(copyClipart([student], publicDir)).resolves.toEqual([]);
    expect(existsSync(path.join(publicDir, clipartAssetKey(student)))).toBe(false);
  });
});
