import { describe, it, expect } from 'vitest';
import { findActiveScene } from '../scenes/SceneRouter';
import type { SceneDirective } from '../types';

const scenes: SceneDirective[] = [
  { type: 'title_card', startTime: 0, endTime: 3, title: '첫 씬' },
  { type: 'title_card', startTime: 3, endTime: 6, title: '둘째 씬' },
];

describe('findActiveScene', () => {
  it('picks the scene containing the time', () => {
    expect(findActiveScene(scenes, 1)?.title).toBe('첫 씬');
    expect(findActiveScene(scenes, 4)?.title).toBe('둘째 씬');
  });

  it('treats endTime as exclusive', () => {
    expect(findActiveScene(scenes, 3)?.title).toBe('둘째 씬');
  });

  it('returns undefined past the last scene', () => {
    expect(findActiveScene(scenes, 10)).toBeUndefined();
  });
});
