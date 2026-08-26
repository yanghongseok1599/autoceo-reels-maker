import { describe, it, expect } from 'vitest';
import { SCENE_TYPES } from '../types';

describe('SCENE_TYPES', () => {
  it('lists all six scene types', () => {
    expect([...SCENE_TYPES].sort()).toEqual(
      ['conclusion', 'content_slide', 'emphasis', 'list_reveal', 'quote', 'title_card'].sort(),
    );
  });

  it('has no duplicates', () => {
    expect(new Set(SCENE_TYPES).size).toBe(SCENE_TYPES.length);
  });
});
