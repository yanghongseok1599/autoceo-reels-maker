import { describe, it, expect } from 'vitest';
import { buildFallbackScenes } from '../pipeline/scenes';
import { STYLE_PRESETS } from '../style-sheet';
import type { SubtitleJSON } from '@studio/video/src/types';

const sheet = {
  ...STYLE_PRESETS.paper,
  ownerId: 'u1', presetId: 'paper', styleSheetUrl: null, backgroundLibrary: ['/bg1.png'],
};

const subs: SubtitleJSON = [
  { id: 0, text: '무릎 통증', start: 0, end: 2, words: [] },
  { id: 1, text: '이렇게 잡으세요', start: 2, end: 5, words: [] },
];

describe('buildFallbackScenes', () => {
  it('produces one title card spanning the whole audio', () => {
    const scenes = buildFallbackScenes(subs, '무릎 통증 이렇게 잡으세요', sheet);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].type).toBe('title_card');
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[0].endTime).toBe(5);
  });

  it('uses the opening line as the title', () => {
    expect(buildFallbackScenes(subs, '대본', sheet)[0].title).toBe('무릎 통증');
  });

  it('falls back to the script when there are no subtitles', () => {
    const scenes = buildFallbackScenes([], '무릎 통증 잡는 법', sheet);
    expect(scenes[0].title).toBe('무릎 통증 잡는 법');
    expect(scenes[0].endTime).toBeGreaterThan(0);
  });

  it('truncates a very long title', () => {
    const long = 'ㄱ'.repeat(200);
    expect(buildFallbackScenes([], long, sheet)[0].title.length).toBeLessThanOrEqual(40);
  });
});
