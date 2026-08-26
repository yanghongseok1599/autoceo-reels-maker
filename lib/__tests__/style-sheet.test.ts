import { describe, it, expect, beforeEach } from 'vitest';
import { getStyleSheet, pickBackground, STYLE_PRESETS } from '../style-sheet';
import { fileStore } from '../store/file-store';

beforeEach(async () => { await fileStore.write('style-sheets', []); });

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
