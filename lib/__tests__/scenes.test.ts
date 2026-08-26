import { describe, it, expect } from 'vitest';
import { buildScenes, generateScenes } from '../pipeline/scenes';
import { planSceneTypes } from '../pipeline/scene-plan';
import { STYLE_PRESETS } from '../style-sheet';
import { getStaggerTiming } from '@studio/video/src/utils/animations';
import type {
  SubtitleJSON, SceneDirective, TitleCardScene, ListRevealScene, ContentSlideScene,
} from '@studio/video/src/types';

/** SceneDirective 유니온에서 title_card만 좁힌다 — 다른 씬 타입에는 title이 없다 */
function asTitleCard(scene: SceneDirective): TitleCardScene {
  if (scene.type !== 'title_card') throw new Error(`title_card가 아님: ${scene.type}`);
  return scene;
}

function asList(scene: SceneDirective): ListRevealScene {
  if (scene.type !== 'list_reveal') throw new Error(`list_reveal이 아님: ${scene.type}`);
  return scene;
}

function asContent(scene: SceneDirective): ContentSlideScene {
  if (scene.type !== 'content_slide') throw new Error(`content_slide가 아님: ${scene.type}`);
  return scene;
}

/**
 * 씬이 화면 한가운데에 반드시 그리는 주 텍스트. 이게 비면 그 세그먼트 길이만큼 빈 화면이
 * 나간다. list_reveal의 `title`은 말머리가 없으면 비는 게 정상이라 항목 쪽을 본다.
 */
function primaryText(scene: SceneDirective): string {
  switch (scene.type) {
    case 'title_card': return scene.title;
    case 'conclusion': return scene.heading;
    case 'emphasis': return scene.keyword;
    case 'quote': return scene.quote;
    case 'content_slide': return scene.heading;
    case 'list_reveal': return scene.items.join('');
  }
}

const seg = (id: number, text: string) => ({ id, text, start: id, end: id + 1, words: [] });
const subs = (...texts: string[]): SubtitleJSON => texts.map((t, i) => seg(i, t));

const sheet = {
  ...STYLE_PRESETS.paper,
  ownerId: 'u1', presetId: 'paper', styleSheetUrl: null, backgroundLibrary: ['/bg1.png'],
};

describe('buildScenes', () => {
  it('opens with a title card that starts where the audio starts', () => {
    const s = subs('무릎 통증', '이렇게 잡으세요');
    const scenes = buildScenes({ subtitles: s, script: '무릎 통증 이렇게 잡으세요', sheet });
    expect(scenes[0].type).toBe('title_card');
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[scenes.length - 1].endTime).toBe(2);
  });

  it('uses the opening line as the title', () => {
    const s = subs('무릎 통증', '이렇게 잡으세요');
    expect(asTitleCard(buildScenes({ subtitles: s, script: '대본', sheet })[0]).title)
      .toBe('무릎 통증');
  });

  it('falls back to the script when there are no subtitles', () => {
    const scenes = buildScenes({ subtitles: [], script: '무릎 통증 잡는 법', sheet });
    expect(asTitleCard(scenes[0]).title).toBe('무릎 통증 잡는 법');
    expect(scenes[0].endTime).toBeGreaterThan(0);
  });

  it('truncates a very long title', () => {
    const long = 'ㄱ'.repeat(200);
    expect(asTitleCard(buildScenes({ subtitles: [], script: long, sheet })[0]).title.length)
      .toBeLessThanOrEqual(40);
  });

  it('makes one scene per subtitle segment', () => {
    const s = subs('제목입니다', '본문을 조금 길게 적어봅니다 여기가 내용입니다', '마무리합니다');
    expect(buildScenes({ subtitles: s, script: '대본', sheet })).toHaveLength(3);
  });

  it('covers the whole audio without gaps', () => {
    const s = subs('제목입니다', '본문입니다 조금 길게 씁니다', '마무리합니다');
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes[0].startTime).toBe(s[0].start);
    expect(scenes[scenes.length - 1].endTime).toBe(s[s.length - 1].end);
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].startTime).toBe(scenes[i - 1].endTime);
    }
  });

  it('still returns a title card when there are no subtitles', () => {
    const scenes = buildScenes({ subtitles: [], script: '무릎 통증 잡는 법', sheet });
    expect(scenes).toHaveLength(1);
    expect(scenes[0].type).toBe('title_card');
  });

  it('closes a gap between two segments instead of leaving a blank frame', () => {
    // STT는 세그먼트 사이에 숨소리만큼의 틈을 남긴다. 그 틈에 활성 씬이 없으면
    // SceneRouter가 빈 AbsoluteFill을 그린다 — 앞 씬이 틈을 먹어야 한다.
    const s: SubtitleJSON = [
      { id: 0, text: '제목', start: 0, end: 1, words: [] },
      { id: 1, text: '마무리합니다', start: 1.4, end: 2.5, words: [] },
    ];
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes[0].endTime).toBe(1.4);
    expect(scenes[1].endTime).toBe(2.5);
  });

  it('opens at frame zero even when speech starts later', () => {
    // TTS 오디오는 말이 나오기 전에 한 박자 침묵이 있어 whisper의 첫 세그먼트가 0.8초에서
    // 시작하기도 한다. 첫 씬을 거기서 시작하면 릴스에서 가장 값비싼 첫 프레임이 검은 화면이
    // 된다. 클램프는 첫 씬을 앞으로만 늘려야 한다 — 뒤는 하나도 밀리지 않는다.
    const s: SubtitleJSON = [
      { id: 0, text: '무릎 통증 잡는 법', start: 0.8, end: 2, words: [] },
      { id: 1, text: '이렇게 잡으세요 지금부터', start: 2.2, end: 3.4, words: [] },
      { id: 2, text: '마무리합니다', start: 3.4, end: 5, words: [] },
    ];
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes[0].startTime).toBe(0);
    expect(scenes.map((scene) => [scene.startTime, scene.endTime]))
      .toEqual([[0, 2.2], [2.2, 3.4], [3.4, 5]]);
  });

  it('keeps the tiling intact after the opening clamp', () => {
    const s: SubtitleJSON = [
      { id: 0, text: '제목입니다', start: 0.8, end: 2, words: [] },
      { id: 1, text: '   ', start: 2, end: 2.6, words: [] },
      { id: 2, text: '마무리합니다', start: 2.9, end: 4.5, words: [] },
    ];
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[scenes.length - 1].endTime).toBe(s[s.length - 1].end);
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].startTime).toBe(scenes[i - 1].endTime);
    }
  });

  it('takes each scene type from the plan, segment for segment', () => {
    const s = subs(
      '제목',
      '첫째 준비, 둘째 하강, 셋째 상승',
      '코치가 "무릎은 발끝을 따라간다"고 했습니다',
      '짧아요',
      '천천히 내려가면서 호흡을 뱉어 주세요',
      '마무리',
    );
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes.map((scene) => scene.type)).toEqual(planSceneTypes(s));
    expect(scenes.map((scene) => scene.type)).toEqual([
      'title_card', 'list_reveal', 'quote', 'emphasis', 'content_slide', 'conclusion',
    ]);
  });

  it('cycles the background library so consecutive scenes differ', () => {
    const twoBg = { ...sheet, backgroundLibrary: ['/bg1.png', '/bg2.png'] };
    const s = subs('제목', '본문을 조금 길게 적어봅니다', '마무리');
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet: twoBg });
    expect(scenes.map((scene) => scene.backgroundImageUrl))
      .toEqual(['/bg1.png', '/bg2.png', '/bg1.png']);
  });

  it('strips quotation marks out of a quote scene', () => {
    const s = subs('제목', '코치가 "무릎은 발끝을 따라간다"고 했습니다', '끝');
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes[1].type).toBe('quote');
    expect(primaryText(scenes[1])).toBe('코치가 무릎은 발끝을 따라간다고 했습니다');
  });
});

/**
 * Task 3은 공백뿐인 세그먼트에도 반드시 타입 하나를 돌려준다 — 배열 길이를 세그먼트와
 * 맞춰야 하기 때문이다. 그래서 그 세그먼트를 실제로 버리는 책임은 여기에 있다.
 * 버리되 시간은 버리지 않는다: 빈 구간은 이웃 씬이 흡수하므로 오디오는 여전히 빈틈없이 덮인다.
 */
describe('buildScenes — 빈 세그먼트', () => {
  it('does not make a scene for a whitespace-only segment', () => {
    const scenes = buildScenes({ subtitles: subs('제목', '   ', '마무리'), script: '대본', sheet });
    expect(scenes).toHaveLength(2);
    expect(scenes.map((s) => s.type)).toEqual(['title_card', 'conclusion']);
  });

  it('hands the span of a dropped segment to the scene before it', () => {
    const scenes = buildScenes({ subtitles: subs('제목', '   ', '마무리'), script: '대본', sheet });
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[0].endTime).toBe(2);
    expect(scenes[1].startTime).toBe(2);
    expect(scenes[1].endTime).toBe(3);
  });

  it('absorbs a leading blank segment into the first real scene', () => {
    const scenes = buildScenes({ subtitles: subs('  ', '제목', '마무리'), script: '대본', sheet });
    expect(scenes[0].startTime).toBe(0);
    expect(asTitleCard(scenes[0]).title).toBe('제목');
  });

  it('absorbs a trailing blank segment into the last real scene', () => {
    const s = subs('제목', '마무리합니다', '   ');
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes[scenes.length - 1].endTime).toBe(3);
  });

  it('still tiles the whole audio when blanks are dropped', () => {
    const s = subs('', '제목입니다', '  ', '본문을 조금 길게 적어봅니다', '\t', '마무리합니다', ' ');
    const scenes = buildScenes({ subtitles: s, script: '대본', sheet });
    expect(scenes).toHaveLength(3);
    expect(scenes[0].startTime).toBe(s[0].start);
    expect(scenes[scenes.length - 1].endTime).toBe(s[s.length - 1].end);
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].startTime).toBe(scenes[i - 1].endTime);
    }
  });

  it('never hands the renderer a scene with no text', () => {
    const s = subs('제목', '  ', '짧아요', '', '첫째 준비, 둘째 하강', '   ', '마무리합니다');
    for (const scene of buildScenes({ subtitles: s, script: '대본', sheet })) {
      expect(primaryText(scene)).not.toBe('');
    }
  });

  it('falls back to one title card when every segment is blank', () => {
    const late: SubtitleJSON = [{ id: 0, text: '  ', start: 0.8, end: 2, words: [] }];
    expect(buildScenes({ subtitles: late, script: '대본', sheet })[0].startTime).toBe(0);

    const s = subs('', '   ');
    const scenes = buildScenes({ subtitles: s, script: '무릎 통증 잡는 법', sheet });
    expect(scenes).toHaveLength(1);
    expect(asTitleCard(scenes[0]).title).toBe('무릎 통증 잡는 법');
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[0].endTime).toBe(2);
  });
});

describe('buildScenes — 목록', () => {
  /**
   * 항목 상한이 지키는 계약: 가장 짧은 목록 씬(1.5초 = 45프레임)에서도 항목 사이 간격이
   * 0.2초(6프레임) 이상 남아야 순차 등장으로 읽힌다. getStaggerTiming의 예산은 25프레임이라
   * 5항목이면 6프레임이지만 6항목이면 5프레임으로 떨어진다.
   */
  const PERCEPTIBLE_STAGGER = 6;

  it('caps the item count so the stagger stays perceptible on a short scene', () => {
    const s: SubtitleJSON = [
      { id: 0, text: '제목', start: 0, end: 1, words: [] },
      { id: 1, text: '하나, 둘, 셋, 넷, 다섯, 여섯, 일곱, 여덟', start: 1, end: 2.5, words: [] },
      { id: 2, text: '끝', start: 2.5, end: 3.5, words: [] },
    ];
    const scene = asList(buildScenes({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.items).toEqual(['하나', '둘', '셋', '넷', '다섯']);

    const frames = Math.round((scene.endTime - scene.startTime) * 30);
    expect(getStaggerTiming(frames, scene.items.length).stagger)
      .toBeGreaterThanOrEqual(PERCEPTIBLE_STAGGER);
  });

  it('splits on ordinals and drops empty items', () => {
    const s = subs('제목', '첫째 준비,, 둘째 하강, , 셋째 상승', '끝');
    expect(asList(buildScenes({ subtitles: s, script: '대본', sheet })[1]).items)
      .toEqual(['준비', '하강', '상승']);
  });

  it('uses the words before the first ordinal as the list title', () => {
    const s = subs('제목', '순서는 이렇습니다 첫째 준비, 둘째 하강, 셋째 상승', '끝');
    const scene = asList(buildScenes({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.title).toBe('순서는 이렇습니다');
    expect(scene.items).toEqual(['준비', '하강', '상승']);
  });

  it('leaves the title empty for a comma-only list, since the lead is itself an item', () => {
    const s = subs('제목', '어깨를 펴고, 무릎을 세우고, 천천히 내려갑니다', '끝');
    const scene = asList(buildScenes({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.title).toBe('');
    expect(scene.items).toEqual(['어깨를 펴고', '무릎을 세우고', '천천히 내려갑니다']);
  });
});

describe('buildScenes — 본문 슬라이드', () => {
  it('gives a content slide a heading rather than an empty one', () => {
    const s = subs('제목', '발바닥을 바닥에 고르게 누르고 천천히 내려가세요', '끝');
    const scene = asContent(buildScenes({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.heading).toBe('발바닥을 바닥에 고르게 누르고 천천히 내려가세요');
    expect(scene.bullets).toEqual([]);
  });

  it('splits a clause off as the heading and keeps the rest as bullets', () => {
    const s = subs('제목', '어깨를 활짝 펴고, 무릎을 천천히 굽혀 주세요', '끝');
    const scene = asContent(buildScenes({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.heading).toBe('어깨를 활짝 펴고');
    expect(scene.bullets).toEqual(['무릎을 천천히 굽혀 주세요']);
  });

  it('moves the tail of a long sentence into a bullet instead of dropping it', () => {
    const line = '천천히 숨을 내쉬면서 무릎이 발끝을 넘지 않도록 주의하며 아주 조금씩 내려가세요';
    const scene = asContent(buildScenes({ subtitles: subs('제목', line, '끝'), script: '대본', sheet })[1]);
    expect(scene.heading).not.toBe('');
    expect(scene.heading.length).toBeLessThanOrEqual(40);
    expect(`${scene.heading} ${scene.bullets.join(' ')}`).toBe(line);
  });
});

describe('generateScenes', () => {
  it('returns the rule-built scenes', async () => {
    const s = subs('제목입니다', '본문을 조금 길게 적어봅니다', '마무리합니다');
    await expect(generateScenes({ script: '대본', subtitles: s, sheet }))
      .resolves.toEqual(buildScenes({ subtitles: s, script: '대본', sheet }));
  });
});
