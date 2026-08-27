import { describe, it, expect } from 'vitest';
import { buildScenes, generateScenes } from '../pipeline/scenes';
import { planSceneTypes } from '../pipeline/scene-plan';
import type { ClipartEntry } from '../clipart';
import { clipartAssetKey } from '../clipart';
import { STYLE_PRESETS } from '../style-sheet';
import { getStaggerTiming } from '@studio/video/src/utils/animations';
import type {
  SubtitleJSON, SceneDirective, TitleCardScene, ListRevealScene, ContentSlideScene,
  ConclusionScene,
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

function asConclusion(scene: SceneDirective): ConclusionScene {
  if (scene.type !== 'conclusion') throw new Error(`conclusion이 아님: ${scene.type}`);
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

/** lib/pipeline/scenes.ts의 MAX_HEADLINE. 표제 카드 표제가 담는 최대 길이 */
const HEADLINE_LIMIT = 64;
/** lib/pipeline/scenes.ts의 MAX_TAIL. 표제 아래 둘째 줄이 담는 최대 길이 */
const TAIL_LIMIT = 40;
/** lib/pipeline/scenes.ts의 MAX_TITLE. 목록 말머리·본문 제목의 상한 */
const TITLE_LIMIT = 40;

/** 정확히 TITLE_LIMIT자인 목록 말머리. 경계에서 어절을 잃는지 보는 표본이다 */
const LEAD_AT_LIMIT = '무릎이 안쪽으로 모이는 문제를 바로잡는 순서는 이렇습니다 가나다라마바사아';
/** 정확히 HEADLINE_LIMIT자인 여는 문장 */
const HEAD_AT_LIMIT = '오늘은 스쿼트를 할 때 무릎이 안쪽으로 자꾸 모이는 아주 흔한 문제를 바로잡는 간단한 팁을 지금부터 다 알려드릴게요';
/** 머리도 꼬리도 넘치는 긴 세그먼트 */
const FAR_OVERFLOW = '오늘은 스쿼트를 할 때 무릎이 안쪽으로 자꾸 모이는 아주 흔한 문제를 바로잡는 간단한 팁을 지금부터 하나씩 차근차근 알려드릴 텐데요 발바닥을 바닥에 고르게 누르고 내려갈 때 무릎이 두 번째 발가락 방향을 그대로 따라가도록 천천히 연습해 보시면 확실히 달라집니다';

const wordsOf = (text: string): string[] => text.split(/\s+/).filter(Boolean);

const sheet = {
  ...STYLE_PRESETS.paper,
  ownerId: 'u1', presetId: 'paper', styleSheetUrl: null, backgroundLibrary: ['/bg1.png'],
};

/**
 * 캐릭터를 보지 않는 검사들이 쓰는 축약. `buildScenes`는 씬 배열과 함께 **쓰인 클립아트**를
 * 돌려주는데(워커가 무엇을 복사할지 알아야 한다) 아래 검사들은 씬만 본다. 빈 카탈로그를
 * 넘기므로 어떤 세그먼트에도 캐릭터가 붙지 않는다.
 */
const scenesOf = (
  input: Omit<Parameters<typeof buildScenes>[0], 'catalog'>,
): SceneDirective[] => buildScenes({ ...input, catalog: [] }).scenes;

describe('buildScenes', () => {
  it('opens with a title card that starts where the audio starts', () => {
    const s = subs('무릎 통증', '이렇게 잡으세요');
    const scenes = scenesOf({ subtitles: s, script: '무릎 통증 이렇게 잡으세요', sheet });
    expect(scenes[0].type).toBe('title_card');
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[scenes.length - 1].endTime).toBe(2);
  });

  it('uses the opening line as the title', () => {
    const s = subs('무릎 통증', '이렇게 잡으세요');
    expect(asTitleCard(scenesOf({ subtitles: s, script: '대본', sheet })[0]).title)
      .toBe('무릎 통증');
  });

  it('falls back to the script when there are no subtitles', () => {
    const scenes = scenesOf({ subtitles: [], script: '무릎 통증 잡는 법', sheet });
    expect(asTitleCard(scenes[0]).title).toBe('무릎 통증 잡는 법');
    expect(scenes[0].endTime).toBeGreaterThan(0);
  });

  /**
   * 대본 전체를 카드 한 장에 담을 방법은 없다. 이 자리에서만은 자르는 게 맞고, 대신
   * 어절 한가운데를 끊지 않고 잘렸다는 표시(말줄임표)를 남긴다.
   */
  it('cuts a whole-script fallback title at a word boundary and marks it', () => {
    // 정확히 상한 길이인 대본은 자르지 않는다 — 말줄임표 자리를 무조건 떼면 여기서 잃는다
    expect(asTitleCard(scenesOf({ subtitles: [], script: HEAD_AT_LIMIT, sheet })[0]).title)
      .toBe(HEAD_AT_LIMIT);

    const long = 'ㄱ'.repeat(200);
    expect(asTitleCard(scenesOf({ subtitles: [], script: long, sheet })[0]).title.length)
      .toBeLessThanOrEqual(HEADLINE_LIMIT);

    const words = Array.from({ length: 60 }, (_, i) => `낱말${i}`);
    const title = asTitleCard(
      scenesOf({ subtitles: [], script: words.join(' '), sheet })[0],
    ).title;
    expect(title.endsWith('…')).toBe(true);
    // 잘린 자리 앞은 언제나 온전한 어절이다 — `낱말1` 이 `낱말` 로 끝나면 안 된다
    for (const word of title.slice(0, -1).trim().split(' ')) {
      expect(words).toContain(word);
    }
  });

  it('makes one scene per subtitle segment', () => {
    const s = subs('제목입니다', '본문을 조금 길게 적어봅니다 여기가 내용입니다', '마무리합니다');
    expect(scenesOf({ subtitles: s, script: '대본', sheet })).toHaveLength(3);
  });

  it('covers the whole audio without gaps', () => {
    const s = subs('제목입니다', '본문입니다 조금 길게 씁니다', '마무리합니다');
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
    expect(scenes[0].startTime).toBe(s[0].start);
    expect(scenes[scenes.length - 1].endTime).toBe(s[s.length - 1].end);
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].startTime).toBe(scenes[i - 1].endTime);
    }
  });

  it('still returns a title card when there are no subtitles', () => {
    const scenes = scenesOf({ subtitles: [], script: '무릎 통증 잡는 법', sheet });
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
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
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
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
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
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
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
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
    expect(scenes.map((scene) => scene.type)).toEqual(planSceneTypes(s));
    expect(scenes.map((scene) => scene.type)).toEqual([
      'title_card', 'list_reveal', 'quote', 'emphasis', 'content_slide', 'conclusion',
    ]);
  });

  it('cycles the background library so consecutive scenes differ', () => {
    const twoBg = { ...sheet, backgroundLibrary: ['/bg1.png', '/bg2.png'] };
    const s = subs('제목', '본문을 조금 길게 적어봅니다', '마무리');
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet: twoBg });
    expect(scenes.map((scene) => scene.backgroundImageUrl))
      .toEqual(['/bg1.png', '/bg2.png', '/bg1.png']);
  });

  it('strips quotation marks out of a quote scene', () => {
    const s = subs('제목', '코치가 "무릎은 발끝을 따라간다"고 했습니다', '끝');
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
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
    const scenes = scenesOf({ subtitles: subs('제목', '   ', '마무리'), script: '대본', sheet });
    expect(scenes).toHaveLength(2);
    expect(scenes.map((s) => s.type)).toEqual(['title_card', 'conclusion']);
  });

  it('hands the span of a dropped segment to the scene before it', () => {
    const scenes = scenesOf({ subtitles: subs('제목', '   ', '마무리'), script: '대본', sheet });
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[0].endTime).toBe(2);
    expect(scenes[1].startTime).toBe(2);
    expect(scenes[1].endTime).toBe(3);
  });

  it('absorbs a leading blank segment into the first real scene', () => {
    const scenes = scenesOf({ subtitles: subs('  ', '제목', '마무리'), script: '대본', sheet });
    expect(scenes[0].startTime).toBe(0);
    expect(asTitleCard(scenes[0]).title).toBe('제목');
  });

  it('absorbs a trailing blank segment into the last real scene', () => {
    const s = subs('제목', '마무리합니다', '   ');
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
    expect(scenes[scenes.length - 1].endTime).toBe(3);
  });

  it('still tiles the whole audio when blanks are dropped', () => {
    const s = subs('', '제목입니다', '  ', '본문을 조금 길게 적어봅니다', '\t', '마무리합니다', ' ');
    const scenes = scenesOf({ subtitles: s, script: '대본', sheet });
    expect(scenes).toHaveLength(3);
    expect(scenes[0].startTime).toBe(s[0].start);
    expect(scenes[scenes.length - 1].endTime).toBe(s[s.length - 1].end);
    for (let i = 1; i < scenes.length; i++) {
      expect(scenes[i].startTime).toBe(scenes[i - 1].endTime);
    }
  });

  it('never hands the renderer a scene with no text', () => {
    const s = subs('제목', '  ', '짧아요', '', '첫째 준비, 둘째 하강', '   ', '마무리합니다');
    for (const scene of scenesOf({ subtitles: s, script: '대본', sheet })) {
      expect(primaryText(scene)).not.toBe('');
    }
  });

  it('falls back to one title card when every segment is blank', () => {
    const late: SubtitleJSON = [{ id: 0, text: '  ', start: 0.8, end: 2, words: [] }];
    expect(scenesOf({ subtitles: late, script: '대본', sheet })[0].startTime).toBe(0);

    const s = subs('', '   ');
    const scenes = scenesOf({ subtitles: s, script: '무릎 통증 잡는 법', sheet });
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
    const scene = asList(scenesOf({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.items).toEqual(['하나', '둘', '셋', '넷', '다섯']);

    const frames = Math.round((scene.endTime - scene.startTime) * 30);
    expect(getStaggerTiming(frames, scene.items.length).stagger)
      .toBeGreaterThanOrEqual(PERCEPTIBLE_STAGGER);
  });

  it('splits on ordinals and drops empty items', () => {
    const s = subs('제목', '첫째 준비,, 둘째 하강, , 셋째 상승', '끝');
    expect(asList(scenesOf({ subtitles: s, script: '대본', sheet })[1]).items)
      .toEqual(['준비', '하강', '상승']);
  });

  it('uses the words before the first ordinal as the list title', () => {
    const s = subs('제목', '순서는 이렇습니다 첫째 준비, 둘째 하강, 셋째 상승', '끝');
    const scene = asList(scenesOf({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.title).toBe('순서는 이렇습니다');
    expect(scene.items).toEqual(['준비', '하강', '상승']);
  });

  it('leaves the title empty for a comma-only list, since the lead is itself an item', () => {
    const s = subs('제목', '어깨를 펴고, 무릎을 세우고, 천천히 내려갑니다', '끝');
    const scene = asList(scenesOf({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.title).toBe('');
    expect(scene.items).toEqual(['어깨를 펴고', '무릎을 세우고', '천천히 내려갑니다']);
  });
});

describe('buildScenes — 본문 슬라이드', () => {
  it('gives a content slide a heading rather than an empty one', () => {
    const s = subs('제목', '발바닥을 바닥에 고르게 누르고 천천히 내려가세요', '끝');
    const scene = asContent(scenesOf({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.heading).toBe('발바닥을 바닥에 고르게 누르고 천천히 내려가세요');
    expect(scene.bullets).toEqual([]);
  });

  it('splits a clause off as the heading and keeps the rest as bullets', () => {
    const s = subs('제목', '어깨를 활짝 펴고, 무릎을 천천히 굽혀 주세요', '끝');
    const scene = asContent(scenesOf({ subtitles: s, script: '대본', sheet })[1]);
    expect(scene.heading).toBe('어깨를 활짝 펴고');
    expect(scene.bullets).toEqual(['무릎을 천천히 굽혀 주세요']);
  });

  it('keeps every word of a long first clause, comma or no comma', () => {
    // content_slide가 받는 문장은 쉼표가 많아야 하나다 — 둘 이상이면 list_reveal로 간다.
    // 그래서 "첫 절이 긴" 문장이 이 씬 타입의 보통 모양이고, 여기서 잘라 버리면 릴스마다
    // 문장 끝이 조용히 사라진다. 쉼표 갈래도 쉼표 없는 갈래와 같은 규칙이어야 한다.
    const line = '천천히 숨을 내쉬면서 무릎이 발끝을 넘지 않도록 아주 조금씩 버티며 내려가세요, 그리고 다시 올라옵니다';
    const scene = asContent(scenesOf({ subtitles: subs('제목', line, '끝'), script: '대본', sheet })[1]);
    expect(scene.heading.length).toBeLessThanOrEqual(40);
    expect([scene.heading, ...scene.bullets].join(' ').split(/\s+/).filter(Boolean))
      .toEqual(line.split(/[\s,]+/).filter(Boolean));
  });

  it('moves the tail of a long sentence into a bullet instead of dropping it', () => {
    const line = '천천히 숨을 내쉬면서 무릎이 발끝을 넘지 않도록 주의하며 아주 조금씩 내려가세요';
    const scene = asContent(scenesOf({ subtitles: subs('제목', line, '끝'), script: '대본', sheet })[1]);
    expect(scene.heading).not.toBe('');
    expect(scene.heading.length).toBeLessThanOrEqual(40);
    expect(`${scene.heading} ${scene.bullets.join(' ')}`).toBe(line);
  });
});

/**
 * 릴스에서 가장 오래 보이는 첫 프레임과 마지막 프레임이다. 여기서 문장 끝이 조용히
 * 사라지면 화면만 봐서는 아무 이상이 없어 보인다 — 저장된 whisper 전사 세 건이 모두
 * 이 자리에서 글자를 잃고 있었다. content_slide와 같은 규칙을 쓴다: 어절 경계에서 자르고
 * 꼬리는 버리지 않는다. 담을 곳도 이미 있다 — TitleCard의 `subtitle`과
 * ConclusionSlide의 `callToAction`은 선언돼 있고 렌더까지 되지만 늘 비어 있었다.
 */
describe('buildScenes — 표제 카드', () => {
  /** public/generated-audio의 실제 whisper 전사에서 그대로 가져온 세그먼트(44·46·50자) */
  const REAL_SEGMENTS = [
    '오늘은 스쿼트 할 때 무릎이 안쪽으로 모이는 문제를 잡는 간단한 팁을 알려드릴게요.',
    '발바닥을 바닥에 고르게 누르고 내려갈 때 무릎이 두 번째 발가락 방향을 따라가게 해보세요.',
    '안녕하세요 오늘은 제가 실제로 쓰고 있는 AI 자동화 세팅을 그대로 보여드릴께요',
  ];

  const LONG = '오늘은 스쿼트를 할 때 무릎이 안쪽으로 자꾸 모이는 아주 흔한 문제를 바로잡는 간단한 팁을 지금부터 하나씩 차근차근 알려드릴게요';

  it('keeps a real whisper segment whole on the opening frame', () => {
    for (const line of REAL_SEGMENTS) {
      const card = asTitleCard(
        scenesOf({ subtitles: subs(line, '끝'), script: '대본', sheet })[0],
      );
      expect(card.title).toBe(line);
      expect(card.subtitle).toBeUndefined();
    }
  });

  it('keeps a real whisper segment whole on the closing frame', () => {
    for (const line of REAL_SEGMENTS) {
      const scenes = scenesOf({ subtitles: subs('제목', line), script: '대본', sheet });
      const card = asConclusion(scenes[scenes.length - 1]);
      expect(card.heading).toBe(line);
      expect(card.callToAction).toBeUndefined();
    }
  });

  it('moves an overflowing opening line into the subtitle instead of dropping it', () => {
    const card = asTitleCard(scenesOf({ subtitles: subs(LONG, '끝'), script: '대본', sheet })[0]);
    expect(card.title).not.toBe('');
    expect(card.title.length).toBeLessThanOrEqual(HEADLINE_LIMIT);
    expect(card.subtitle).toBeTruthy();
    expect(wordsOf(`${card.title} ${card.subtitle}`)).toEqual(wordsOf(LONG));
  });

  it('moves an overflowing closing line into the call to action instead of dropping it', () => {
    const scenes = scenesOf({ subtitles: subs('제목', LONG), script: '대본', sheet });
    const card = asConclusion(scenes[scenes.length - 1]);
    expect(card.heading).not.toBe('');
    expect(card.heading.length).toBeLessThanOrEqual(HEADLINE_LIMIT);
    expect(card.callToAction).toBeTruthy();
    expect(wordsOf(`${card.heading} ${card.callToAction}`)).toEqual(wordsOf(LONG));
  });

  it('keeps an opening line of exactly the headline limit whole', () => {
    expect(HEAD_AT_LIMIT).toHaveLength(HEADLINE_LIMIT);
    const card = asTitleCard(
      scenesOf({ subtitles: subs(HEAD_AT_LIMIT, '끝'), script: '대본', sheet })[0],
    );
    expect(card.title).toBe(HEAD_AT_LIMIT);
    expect(card.subtitle).toBeUndefined();
  });

  /**
   * 머리만 자르고 꼬리를 놔두면 넘침이 둘째 줄로 자리만 옮긴다. 꼬리의 꼬리를 내려보낼
   * 필드는 없으므로 여기서는 잘라야 하고, 대신 말줄임표로 잘렸다는 표시를 남긴다.
   */
  it('bounds the overflow tail instead of moving the problem to the second line', () => {
    const card = asTitleCard(
      scenesOf({ subtitles: subs(FAR_OVERFLOW, '끝'), script: '대본', sheet })[0],
    );
    const sub = card.subtitle ?? '';
    expect(sub.length).toBeGreaterThan(0);
    expect(sub.length).toBeLessThanOrEqual(TAIL_LIMIT);
    expect(sub.endsWith('…')).toBe(true);

    const scenes = scenesOf({ subtitles: subs('제목', FAR_OVERFLOW), script: '대본', sheet });
    const cta = asConclusion(scenes[scenes.length - 1]).callToAction ?? '';
    expect(cta.length).toBeGreaterThan(0);
    expect(cta.length).toBeLessThanOrEqual(TAIL_LIMIT);
    expect(cta.endsWith('…')).toBe(true);
  });

  it('never cuts a 어절 in half', () => {
    const words = wordsOf(LONG);
    const card = asTitleCard(scenesOf({ subtitles: subs(LONG, '끝'), script: '대본', sheet })[0]);
    const scenes = scenesOf({ subtitles: subs('제목', LONG), script: '대본', sheet });
    const close = asConclusion(scenes[scenes.length - 1]);
    for (const word of [...wordsOf(card.title), ...wordsOf(close.heading)]) {
      expect(words).toContain(word);
    }
  });
});

/**
 * 꼬리를 내려보낼 필드가 없는 자리는 자를 수밖에 없다. 그렇다고 **딱 맞는** 문장까지
 * 자르면 안 된다 — 말줄임표 자리를 조건 없이 떼는 구현은 정확히 상한 길이인 말머리에서
 * 마지막 어절을 통째로 잃었다. 글자 손실을 없애려던 변경이 새 손실을 만든 자리다.
 */
describe('buildScenes — 자르기 경계', () => {
  const listLine = (lead: string) => `${lead} 첫째 준비, 둘째 하강`;

  it('keeps a list lead-in of exactly the limit whole', () => {
    expect(LEAD_AT_LIMIT).toHaveLength(TITLE_LIMIT);
    const s = subs('제목', listLine(LEAD_AT_LIMIT), '끝');
    expect(asList(scenesOf({ subtitles: s, script: '대본', sheet })[1]).title)
      .toBe(LEAD_AT_LIMIT);
  });

  it('ellipsizes at a word boundary once past the limit', () => {
    const over = `${LEAD_AT_LIMIT}자`;
    expect(over.length).toBeGreaterThan(TITLE_LIMIT);
    const s = subs('제목', listLine(over), '끝');
    const title = asList(scenesOf({ subtitles: s, script: '대본', sheet })[1]).title;

    expect(title.length).toBeLessThanOrEqual(TITLE_LIMIT);
    expect(title.endsWith('…')).toBe(true);
    // 남은 조각은 전부 원문의 온전한 어절이다 — 어절 한가운데서 끊지 않는다
    for (const word of wordsOf(title.slice(0, -1))) {
      expect(wordsOf(over)).toContain(word);
    }
  });
});

/**
 * 씬에 캐릭터를 붙이는 규칙의 표본. 매칭 자체는 `lib/__tests__/clipart.test.ts`가 검사하므로
 * 아래 검사들은 **붙는 자리와 주소의 모양**만 본다 — 이 둘이 어긋나면 렌더는 성공하는데
 * 그림만 조용히 빠진다.
 */
const PRESET_CATALOG: ClipartEntry[] = [{
  id: 'c1', ownerId: '__preset__', keyword: '걱정', aliases: ['불안'],
  category: '감정', source: 'preset', file: 'assets/clipart/걱정.png',
}];

const studentEntry = (file: string): ClipartEntry => ({
  id: 'c2', ownerId: 'u1', keyword: '걱정', aliases: [],
  category: '감정', source: 'student', file,
});

describe('generateScenes', () => {
  it('returns the rule-built scenes', async () => {
    const s = subs('제목입니다', '본문을 조금 길게 적어봅니다', '마무리합니다');
    await expect(generateScenes({ script: '대본', subtitles: s, sheet, catalog: [] }))
      .resolves.toEqual(buildScenes({ subtitles: s, script: '대본', sheet, catalog: [] }));
  });

  it('carries the matched clipart through to the caller', async () => {
    const s = subs('제목', '많이 걱정하시죠 무릎 통증 때문에', '끝');
    const { usedClipart } = await generateScenes({
      script: '대본', subtitles: s, sheet, catalog: PRESET_CATALOG,
    });
    expect(usedClipart).toEqual([PRESET_CATALOG[0]]);
  });
});

describe('buildScenes — 캐릭터', () => {
  it('attaches a character when the text matches', () => {
    const s = subs('제목', '많이 걱정하시죠 무릎 통증 때문에', '끝');
    const { scenes, usedClipart } = buildScenes({
      subtitles: s, script: '대본', sheet, catalog: PRESET_CATALOG,
    });
    expect(scenes[1].characterImageUrl).toMatch(/^clipart\//);
    expect(usedClipart.map((c) => c.keyword)).toEqual(['걱정']);
  });

  it('leaves a scene without a character when nothing matches', () => {
    const s = subs('제목', '발바닥을 바닥에 고르게 누르세요 천천히', '끝');
    const { scenes, usedClipart } = buildScenes({
      subtitles: s, script: '대본', sheet, catalog: PRESET_CATALOG,
    });
    expect(scenes[1].characterImageUrl).toBeUndefined();
    expect(usedClipart).toEqual([]);
  });

  // 같은 그림을 세 씬이 쓰면 복사는 한 번이면 된다. 워커가 이 목록만큼 파일을 옮긴다.
  it('reports a repeated clipart only once', () => {
    const s = subs('제목', '걱정이 됩니다 정말 많이', '걱정하지 마세요 괜찮습니다', '끝');
    expect(buildScenes({
      subtitles: s, script: '대본', sheet, catalog: PRESET_CATALOG,
    }).usedClipart).toHaveLength(1);
  });

  /**
   * 프리셋 그림은 `public/` **밖**에 있으므로 렌더 전에 복사되고, 씬은 그 복사본의 자리를
   * 가리킨다. 원본 경로(`assets/clipart/걱정.png`)를 그대로 넘기면 렌더러가 찾지 못한다.
   */
  it('points a preset scene at the copied asset key, not the source path', () => {
    const s = subs('제목', '많이 걱정하시죠 무릎 통증 때문에', '끝');
    const { scenes } = buildScenes({
      subtitles: s, script: '대본', sheet, catalog: PRESET_CATALOG,
    });
    expect(scenes[1].characterImageUrl).toBe(clipartAssetKey(PRESET_CATALOG[0]));
  });

  /**
   * 수강생 그림은 다르다. `file`은 `ArtifactStore.publish`가 돌려준 값이라 이미 도달
   * 가능하다 — 배포에서는 절대 Blob URL이고, 로컬에서는 public 루트 기준 상대 경로다.
   * 여기서 `clipartAssetKey`로 바꿔 버리면 아무도 그 자리에 파일을 놓지 않아 그림이 사라진다.
   */
  it('hands a student image straight through — publish already made it reachable', () => {
    const s = subs('제목', '많이 걱정하시죠 무릎 통증 때문에', '끝');
    const relative = buildScenes({
      subtitles: s, script: '대본', sheet, catalog: [studentEntry('clipart/ab12.png')],
    });
    expect(relative.scenes[1].characterImageUrl).toBe('clipart/ab12.png');

    const remote = buildScenes({
      subtitles: s, script: '대본', sheet, catalog: [studentEntry('https://cdn.test/ab12.png')],
    });
    expect(remote.scenes[1].characterImageUrl).toBe('https://cdn.test/ab12.png');
  });

  // 앞 슬래시가 붙은 경로는 Remotion이 번들 origin이 아니라 다른 자리를 찾는다.
  it('strips a leading slash from a student path', () => {
    const s = subs('제목', '많이 걱정하시죠 무릎 통증 때문에', '끝');
    const { scenes } = buildScenes({
      subtitles: s, script: '대본', sheet, catalog: [studentEntry('/clipart/ab12.png')],
    });
    expect(scenes[1].characterImageUrl).toBe('clipart/ab12.png');
  });

  // 빈 `file`은 주소가 아니다. 붙여 봐야 렌더러가 자기 origin을 그림으로 받는다.
  it('ignores an entry with no file', () => {
    const s = subs('제목', '많이 걱정하시죠 무릎 통증 때문에', '끝');
    const { scenes, usedClipart } = buildScenes({
      subtitles: s, script: '대본', sheet, catalog: [studentEntry('   ')],
    });
    expect(scenes[1].characterImageUrl).toBeUndefined();
    expect(usedClipart).toEqual([]);
  });

  it('gives the fallback title card no character', () => {
    const { scenes, usedClipart } = buildScenes({
      subtitles: [], script: '많이 걱정하시죠', sheet, catalog: PRESET_CATALOG,
    });
    expect(scenes[0].characterImageUrl).toBeUndefined();
    expect(usedClipart).toEqual([]);
  });
});
