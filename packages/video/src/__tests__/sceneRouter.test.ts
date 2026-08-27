import { describe, it, expect } from 'vitest';
import {
  characterRunStart, findActiveScene, renderScene, withReelBackground,
} from '../scenes/SceneRouter';
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

const base = { startTime: 0, endTime: 3 };

/**
 * 타입별 최소 씬 하나씩. `Record<SceneDirective['type'], …>`이라 SCENE_TYPES에 타입이
 * 늘면 여기 빠진 항목이 곧바로 타입 에러가 된다.
 */
const sample: Record<SceneDirective['type'], SceneDirective> = {
  title_card: { ...base, type: 'title_card', title: 'ㄱ' },
  content_slide: { ...base, type: 'content_slide', heading: 'ㄱ', bullets: ['a'] },
  emphasis: { ...base, type: 'emphasis', keyword: 'ㄱ' },
  list_reveal: { ...base, type: 'list_reveal', title: 'ㄱ', items: ['a'] },
  quote: { ...base, type: 'quote', quote: 'ㄱ' },
  conclusion: { ...base, type: 'conclusion', heading: 'ㄱ' },
};

describe('renderScene', () => {
  /**
   * SCENE_TYPES를 직접 돌면서 각 타입이 실제로 엘리먼트를 돌려주는지 본다. 목록에만 있고
   * renderScene에 분기가 없는 타입은 여기서 null로 떨어져 잡힌다.
   */
  it('returns an element for every type listed in SCENE_TYPES', () => {
    for (const type of SCENE_TYPES) {
      expect(renderScene(sample[type], FALLBACK_PALETTE)).not.toBeNull();
    }
  });

  it('returns null for an unknown type', () => {
    expect(renderScene({ ...base, type: 'nope' } as never, FALLBACK_PALETTE)).toBeNull();
  });
});

/**
 * types.ts는 "씬에 배경이 없으면 ReelProps.backgroundImageUrl을 쓴다"고 적어 두었다.
 * 그 문장을 참으로 만드는 함수다 — 예전에는 아무도 그 prop을 읽지 않았다.
 */
describe('withReelBackground', () => {
  it('fills an empty scene background from the reel background', () => {
    expect(withReelBackground(sample.title_card, '/reel.png').backgroundImageUrl)
      .toBe('/reel.png');
  });

  it('leaves a scene that already has its own background alone', () => {
    const own = { ...sample.title_card, backgroundImageUrl: '/scene.png' };
    expect(withReelBackground(own, '/reel.png')).toBe(own);
  });

  it('leaves the scene alone when there is no reel background either', () => {
    expect(withReelBackground(sample.title_card, undefined)).toBe(sample.title_card);
    expect(withReelBackground(sample.title_card, undefined).backgroundImageUrl).toBeUndefined();
  });
});

/**
 * 캐릭터 등장 모션의 기준 시각. 씬마다 새로 잡으면 릴 전체에 같은 캐릭터를 붙였을 때
 * 씬 경계마다 캐릭터가 깜빡인다 — 그래서 "그림이 바뀐 시점"을 기준으로 삼는다.
 */
describe('characterRunStart', () => {
  const run: SceneDirective[] = [
    { type: 'title_card', startTime: 0, endTime: 3, title: 'ㄱ', characterImageUrl: 'a.png' },
    { type: 'title_card', startTime: 3, endTime: 6, title: 'ㄴ', characterImageUrl: 'a.png' },
    { type: 'title_card', startTime: 6, endTime: 9, title: 'ㄷ', characterImageUrl: 'b.png' },
    { type: 'title_card', startTime: 9, endTime: 12, title: 'ㄹ' },
    { type: 'title_card', startTime: 12, endTime: 15, title: 'ㅁ', characterImageUrl: 'b.png' },
  ];

  it('keeps the first appearance as the anchor while the image repeats', () => {
    expect(characterRunStart(run, 0)).toBe(0);
    expect(characterRunStart(run, 1)).toBe(0);
  });

  it('re-anchors when the image changes', () => {
    expect(characterRunStart(run, 2)).toBe(6);
  });

  /** 중간에 캐릭터 없는 씬이 끼면 같은 그림이라도 다시 등장하는 게 맞다 */
  it('re-anchors after a gap with no character', () => {
    expect(characterRunStart(run, 4)).toBe(12);
  });

  it('returns 0 for an index that is not there', () => {
    expect(characterRunStart(run, -1)).toBe(0);
    expect(characterRunStart([], 0)).toBe(0);
  });
});
