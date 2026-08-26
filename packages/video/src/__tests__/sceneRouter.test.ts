import { describe, it, expect } from 'vitest';
import { findActiveScene } from '../scenes/SceneRouter';
import type { SceneDirective } from '../types';

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
