import { describe, it, expect } from 'vitest';
import { findActiveScene, renderScene } from '../scenes/SceneRouter';
import type { SceneDirective } from '../types';
import { FALLBACK_PALETTE, SCENE_TYPES } from '../types';

/** SceneDirective 유니온에서 title_card만 좁혀 제목을 읽는다 */
function titleOf(scene: SceneDirective | undefined): string | undefined {
  return scene?.type === 'title_card' ? scene.title : undefined;
}

const scenes: SceneDirective[] = [
  { type: 'title_card', startTime: 0, endTime: 3, title: '첫 씬' },
  { type: 'title_card', startTime: 3, endTime: 6, title: '둘째 씬' },
];

describe('findActiveScene', () => {
  it('picks the scene containing the time', () => {
    expect(titleOf(findActiveScene(scenes, 1))).toBe('첫 씬');
    expect(titleOf(findActiveScene(scenes, 4))).toBe('둘째 씬');
  });

  it('treats endTime as exclusive', () => {
    expect(titleOf(findActiveScene(scenes, 3))).toBe('둘째 씬');
  });

  it('returns undefined past the last scene', () => {
    expect(findActiveScene(scenes, 10)).toBeUndefined();
  });
});

describe('renderScene', () => {
  const base = { startTime: 0, endTime: 3 };

  it('returns an element for every scene type', () => {
    const cases = [
      { ...base, type: 'title_card', title: 'ㄱ' },
      { ...base, type: 'content_slide', heading: 'ㄱ', bullets: ['a'] },
      { ...base, type: 'emphasis', keyword: 'ㄱ' },
      { ...base, type: 'list_reveal', title: 'ㄱ', items: ['a'] },
      { ...base, type: 'quote', quote: 'ㄱ' },
      { ...base, type: 'conclusion', heading: 'ㄱ' },
    ] as const;

    for (const scene of cases) {
      expect(renderScene(scene as never, FALLBACK_PALETTE)).not.toBeNull();
    }
  });

  it('covers every type listed in SCENE_TYPES', () => {
    expect(SCENE_TYPES.length).toBe(6);
  });

  it('returns null for an unknown type', () => {
    expect(renderScene({ ...base, type: 'nope' } as never, FALLBACK_PALETTE)).toBeNull();
  });
});
