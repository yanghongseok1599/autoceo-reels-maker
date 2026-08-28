import { describe, it, expect } from 'vitest';
import {
  getStyleSheet, pickBackground, saveStyleSheet, STYLE_PRESETS, type StyleSheet,
} from '../style-sheet';
import { store } from '../store';

/** 저장소는 `vitest.setup.ts`가 테스트마다 새 `STORE_DIR`을 주므로 따로 비울 것이 없다. */
const sheetFor = (ownerId: string, accent: string): StyleSheet => ({
  ownerId,
  presetId: 'paper',
  styleSheetUrl: null,
  palette: { accent, ink: '#2b2118', paper: '#f2e8d5' },
  toneWords: ['종이 질감'],
  backgroundLibrary: [],
});

describe('STYLE_PRESETS', () => {
  it('ships at least three operator presets', () => {
    expect(Object.keys(STYLE_PRESETS).length).toBeGreaterThanOrEqual(3);
  });

  it('gives every preset a full palette', () => {
    for (const preset of Object.values(STYLE_PRESETS)) {
      expect(preset.palette.accent).toMatch(/^#/);
      expect(preset.palette.ink).toMatch(/^#/);
      expect(preset.palette.paper).toMatch(/^#/);
    }
  });
});

describe('getStyleSheet', () => {
  it('falls back to the default preset for a new student', async () => {
    const sheet = await getStyleSheet('u1');
    expect(sheet.ownerId).toBe('u1');
    expect(sheet.palette.accent).toMatch(/^#/);
    expect(sheet.backgroundLibrary).toEqual([]);
  });
});

describe('pickBackground', () => {
  const sheet = { backgroundLibrary: ['/a.png', '/b.png', '/c.png'] } as never;

  it('cycles through the library so scenes differ', () => {
    expect(pickBackground(sheet, 0)).toBe('/a.png');
    expect(pickBackground(sheet, 1)).toBe('/b.png');
    expect(pickBackground(sheet, 3)).toBe('/a.png');
  });

  it('returns undefined when the library is empty', () => {
    expect(pickBackground({ backgroundLibrary: [] } as never, 0)).toBeUndefined();
  });
});

/**
 * 스타일시트는 소유자당 하나뿐이라 예전에는 배열 하나를 통째로 읽고 고쳐 다시 썼다.
 * 그러면 두 수강생이 같은 순간에 저장할 때 한쪽이 다른 쪽을 지웠다.
 */
describe('saveStyleSheet – 소유자별 키', () => {
  it('keeps both sheets when two students save at the same time', async () => {
    await Promise.all([
      saveStyleSheet(sheetFor('u1', '#111111')),
      saveStyleSheet(sheetFor('u2', '#222222')),
    ]);
    expect((await getStyleSheet('u1')).palette.accent).toBe('#111111');
    expect((await getStyleSheet('u2')).palette.accent).toBe('#222222');
  });

  it('writes each student to their own key', async () => {
    await saveStyleSheet(sheetFor('u1', '#111111'));
    expect(await store.read<StyleSheet | null>('style-sheets/u1', null)).not.toBeNull();
    expect(await store.read('style-sheets', null)).toBeNull();
  });

  // 소유권 경계는 이번 변경으로도 그대로여야 한다.
  it('still shows a student nothing of another student', async () => {
    await saveStyleSheet(sheetFor('u1', '#111111'));
    const theirs = await getStyleSheet('u2');
    expect(theirs.ownerId).toBe('u2');
    expect(theirs.palette.accent).not.toBe('#111111');
  });

  /**
   * 필터가 **두 번째 겹**이라는 것을 직접 눌러 본다. 키가 이미 소유자를 나누므로 이 검사가
   * 없으면 필터를 지워도 아무것도 실패하지 않는다 — 그러면 언젠가 "이제 중복"이라며
   * 지워지고, 그 뒤 키 구조를 바꾸는 사람은 경계가 열리는 걸 못 본다.
   */
  it("drops a foreign-owned sheet that somehow sits in this student's key", async () => {
    await store.write('style-sheets/u1', sheetFor('u2', '#222222'));
    const mine = await getStyleSheet('u1');
    expect(mine.ownerId).toBe('u1');
    expect(mine.palette.accent).not.toBe('#222222');
  });
});
