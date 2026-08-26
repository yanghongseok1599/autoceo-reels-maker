# 씬 다양화 — 구현 계획 (계획 2a)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 모든 릴스가 타이틀 카드 하나로 끝나는 상태를 벗어나, 대본이 여섯 종류의 씬으로 전개되게 한다.

**Architecture:** 씬 타입을 6종으로 늘리고, 자막 세그먼트를 규칙으로 씬 타입에 배정한다. LLM 없이 결정론적으로 동작하므로 API 키가 필요 없고 테스트가 가능하다. 캐릭터 연동은 계획 2b가 맡으며, 이 계획은 `SceneBase.characterImageUrl` 자리만 만들어 둔다.

**Tech Stack:** Next.js 16 · React 19 · Remotion 4.0.517 · TypeScript · Vitest

**Spec:** `docs/superpowers/specs/2026-08-26-unified-video-studio-design.md`

## Global Constraints

- 세로 해상도는 **1080×1920**, fps **30** 고정
- 색 리터럴이 허용되는 파일은 `packages/video/src/types.ts` 하나뿐이다. 가드 테스트가 강제한다
- 저장소 접근은 항상 `store` 인터페이스를 통한다. 프로덕션 코드는 `fileStore`를 직접 import하지 않는다
- 커밋 전 `npx vitest run` · `npx tsc --noEmit` · `npx next build`가 모두 깨끗해야 한다
- 커밋은 각 Task 끝에서 한 번씩 한다
- 한국어 UI 문구를 유지한다
- **Remotion에 넘기는 미디어 경로는 public 루트 기준 상대 경로다.** 절대 파일시스템 경로는 렌더러가 받지 못한다 (`packages/video/src/utils/audioSrc.ts` 참고)

## 범위에서 뺀 것과 이유

- **캐릭터 전체**: 계획 2b로 분리했다. 수강생마다 자기 캐릭터를 써야 하므로 저장·업로드·소유권이 목소리와 같은 구조로 들어가고, 그것만으로 Task가 여섯 개다. 씬은 캐릭터 없이도 완결되고 출력물이 즉시 달라지므로 먼저 낸다.
- **Rive 캐릭터**: 하지 않는다. 상황별 이미지를 쓰는 방식이 리깅 1개 + 상태 5개보다 표현이 넓고, 에디터 작업 1~2일이 사라진다.
- **LLM 씬 선택**: API 키가 없다. 규칙 기반으로 충분히 동작하며, LLM은 나중에 같은 인터페이스 뒤에 들어간다.
- **AI 배경 이미지 생성**: 씬이 여섯 종류로 갈리면 화면이 이미 바뀐다. 배경까지 생성하는 건 크레딧을 쓰는 일이라 씬만으로 부족한 게 확인된 뒤에 판단한다. `StyleSheet.backgroundLibrary`는 비운 채 두고 팔레트 그라디언트를 쓴다.

---

## File Structure

**신규**

| 경로 | 책임 |
|---|---|
| `packages/video/src/scenes/ContentSlide.tsx` | 제목 + 불릿 |
| `packages/video/src/scenes/KeywordEmphasis.tsx` | 키워드 하나를 크게 |
| `packages/video/src/scenes/ListReveal.tsx` | 항목이 순차로 등장 |
| `packages/video/src/scenes/QuoteSlide.tsx` | 인용/강조 문장 |
| `packages/video/src/scenes/ConclusionSlide.tsx` | 마무리 + CTA |
| `lib/pipeline/scene-plan.ts` | 자막 세그먼트 → 씬 타입 배정 |

**수정**

| 경로 | 변경 |
|---|---|
| `packages/video/src/types.ts` | 씬 5종 인터페이스 + `SceneDirective` 유니온 확장 |
| `packages/video/src/scenes/SceneRouter.tsx` | 6종 분기 |
| `lib/pipeline/scenes.ts` | `buildFallbackScenes`가 씬 계획을 쓰도록 |
| `lib/learning-store.ts` | 처방에 표본 문턱 |

---

## Task 1: 씬 타입 6종 정의

**Files:**
- Modify: `packages/video/src/types.ts`
- Test: `packages/video/src/__tests__/sceneTypes.test.ts`

**Interfaces:**
- Consumes: 기존 `TitleCardScene`, `Palette`
- Produces:
  - `SceneBase { startTime: number; endTime: number; colorAccent?: string; backgroundImageUrl?: string; characterImageUrl?: string }`
  - `ContentSlideScene extends SceneBase { type: 'content_slide'; heading: string; bullets: string[] }`
  - `EmphasisScene extends SceneBase { type: 'emphasis'; keyword: string; context?: string }`
  - `ListRevealScene extends SceneBase { type: 'list_reveal'; title: string; items: string[] }`
  - `QuoteScene extends SceneBase { type: 'quote'; quote: string; author?: string }`
  - `ConclusionScene extends SceneBase { type: 'conclusion'; heading: string; callToAction?: string }`
  - `SceneDirective` = 위 5종 + `TitleCardScene` 유니온
  - `SCENE_TYPES: readonly SceneDirective['type'][]`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/video/src/__tests__/sceneTypes.test.ts`:

```ts
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
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run packages/video/src/__tests__/sceneTypes.test.ts
```

기대: FAIL — `SCENE_TYPES` export 없음

- [ ] **Step 3: 타입 정의**

`packages/video/src/types.ts`에서 `TitleCardScene`을 `SceneBase` 기반으로 바꾸고 5종을 추가한다. 기존 `TitleCardScene`의 필드(`title`, `subtitle`, `colorAccent`, `backgroundImageUrl`)는 그대로 유지해야 한다 — `TitleCard.tsx`가 이미 읽고 있다.

```ts
export interface SceneBase {
  startTime: number;
  endTime: number;
  colorAccent?: string;
  /** 이 씬에만 적용할 배경. 없으면 ReelProps.backgroundImageUrl을 쓴다 */
  backgroundImageUrl?: string;
  /** 계획 2b가 채운다. public 루트 기준 상대 경로 — 절대 파일 경로는 렌더러가 받지 못한다 */
  characterImageUrl?: string;
}

export interface TitleCardScene extends SceneBase {
  type: 'title_card';
  title: string;
  subtitle?: string;
}

export interface ContentSlideScene extends SceneBase {
  type: 'content_slide';
  heading: string;
  bullets: string[];
}

export interface EmphasisScene extends SceneBase {
  type: 'emphasis';
  keyword: string;
  context?: string;
}

export interface ListRevealScene extends SceneBase {
  type: 'list_reveal';
  title: string;
  items: string[];
}

export interface QuoteScene extends SceneBase {
  type: 'quote';
  quote: string;
  author?: string;
}

export interface ConclusionScene extends SceneBase {
  type: 'conclusion';
  heading: string;
  callToAction?: string;
}

export type SceneDirective =
  | TitleCardScene
  | ContentSlideScene
  | EmphasisScene
  | ListRevealScene
  | QuoteScene
  | ConclusionScene;

export const SCENE_TYPES = [
  'title_card', 'content_slide', 'emphasis', 'list_reveal', 'quote', 'conclusion',
] as const satisfies readonly SceneDirective['type'][];
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
```

기대: 전부 PASS. `tsc`가 깨지면 기존 코드가 `SceneDirective`를 `TitleCardScene`으로 좁혀 쓰고 있다는 뜻이니, 그 자리에 `scene.type === 'title_card'` 판별을 넣는다.

- [ ] **Step 5: 커밋**

```bash
git add packages/video/src/types.ts packages/video/src/__tests__/sceneTypes.test.ts
git commit -m "feat: define five more vertical scene types"
```

---

## Task 2: 씬 컴포넌트 5종

`TitleCard.tsx`가 이 프로젝트의 씬 컴포넌트 규범이다. 먼저 읽고 그 구조를 따른다 — 팔레트에서 색을 받고, `getEntryExitOpacity`/`getExitBlur`/`getEntryExitScale`로 입퇴장을 처리하고, 색 리터럴을 쓰지 않는다.

**Files:**
- Create: `packages/video/src/scenes/ContentSlide.tsx`, `KeywordEmphasis.tsx`, `ListReveal.tsx`, `QuoteSlide.tsx`, `ConclusionSlide.tsx`
- Modify: `packages/video/src/scenes/SceneRouter.tsx`
- Test: `packages/video/src/__tests__/sceneRouter.test.ts` (기존 파일에 추가)

**Interfaces:**
- Consumes: Task 1의 씬 타입, `Palette`, `utils/animations`
- Produces:
  - `<ContentSlide scene={ContentSlideScene} palette={Palette} />`
  - `<KeywordEmphasis scene={EmphasisScene} palette={Palette} />`
  - `<ListReveal scene={ListRevealScene} palette={Palette} />`
  - `<QuoteSlide scene={QuoteScene} palette={Palette} />`
  - `<ConclusionSlide scene={ConclusionScene} palette={Palette} />`
  - `SceneRouter`가 6종 전부 분기한다. `characterImageUrl` 처리는 계획 2b가 붙인다

**세로 레이아웃 기준값** — `TitleCard`와 일관되게 잡는다:

| 요소 | 값 |
|---|---|
| 본문 최대 폭 | 920 |
| 좌우 패딩 | `0 60px` |
| 제목 | 64 / 900 |
| 본문·항목 | 40 / 600 |
| 인용문 | 52 / 700 |
| 강조 키워드 | 108 / 900 |
| 항목 간격 | 24 |

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/video/src/__tests__/sceneRouter.test.ts`에 추가한다:

```ts
import { renderScene } from '../scenes/SceneRouter';
import { FALLBACK_PALETTE } from '../types';

describe('renderScene', () => {
  const base = { startTime: 0, endTime: 3 };

  it('returns an element for every scene type', () => {
    const scenes = [
      { ...base, type: 'title_card', title: 'ㄱ' },
      { ...base, type: 'content_slide', heading: 'ㄱ', bullets: ['a'] },
      { ...base, type: 'emphasis', keyword: 'ㄱ' },
      { ...base, type: 'list_reveal', title: 'ㄱ', items: ['a'] },
      { ...base, type: 'quote', quote: 'ㄱ' },
      { ...base, type: 'conclusion', heading: 'ㄱ' },
    ] as const;

    for (const scene of scenes) {
      expect(renderScene(scene as never, FALLBACK_PALETTE)).not.toBeNull();
    }
  });

  it('returns null for an unknown type', () => {
    expect(renderScene({ ...base, type: 'nope' } as never, FALLBACK_PALETTE)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run packages/video/src/__tests__/sceneRouter.test.ts
```

기대: FAIL — `renderScene` export 없음

- [ ] **Step 3: 씬 컴포넌트 5종 작성**

각 컴포넌트는 `TitleCard.tsx`의 골격을 따른다: `sceneFrame`/`sceneDuration` 계산 → `getEntryExitOpacity`·`getExitBlur`·`getEntryExitScale` → 배경(이미지 있으면 `Img` + `${palette.paper}73` 오버레이, 없으면 `radial-gradient(... ${accent}25 0%, ${palette.paper}f2 70%)`) → 본문.

`ListReveal`만 추가 동작이 있다: 항목이 순차로 등장한다. 항목 `i`는 `sceneFrame`이 `i * 8`을 넘을 때부터 나타난다.

```tsx
const itemOpacity = (i: number) =>
  interpolate(sceneFrame, [i * 8, i * 8 + 10], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
```

색은 전부 `palette.ink`(본문) · `palette.accent`(강조) · `palette.paper`(배경·그림자)에서 온다. 리터럴을 쓰면 가드 테스트가 실패한다.

- [ ] **Step 4: SceneRouter를 6종으로 확장**

`renderScene`을 export해서 테스트 가능하게 만든다:

```tsx
export function renderScene(scene: SceneDirective, palette: Palette): React.ReactNode {
  switch (scene.type) {
    case 'title_card': return <TitleCard scene={scene} palette={palette} />;
    case 'content_slide': return <ContentSlide scene={scene} palette={palette} />;
    case 'emphasis': return <KeywordEmphasis scene={scene} palette={palette} />;
    case 'list_reveal': return <ListReveal scene={scene} palette={palette} />;
    case 'quote': return <QuoteSlide scene={scene} palette={palette} />;
    case 'conclusion': return <ConclusionSlide scene={scene} palette={palette} />;
    default: return null;
  }
}

export const SceneRouter: React.FC<{ scenes: SceneDirective[]; palette: Palette }> = ({ scenes, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = findActiveScene(scenes, frame / fps);
  if (!active) return <AbsoluteFill />;

  return (
    <AbsoluteFill>
      {renderScene(active, palette)}
    </AbsoluteFill>
  );
};
```

`findActiveScene`의 시그니처는 바꾸지 않는다 — 기존 테스트가 그대로 통과해야 한다.

- [ ] **Step 5: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
```

기대: 전부 PASS. 색 가드 테스트도 통과해야 한다.

- [ ] **Step 6: 눈으로 확인**

씬 6종을 순서대로 넣은 props로 렌더하고 각 씬 구간에서 프레임을 뽑는다.

```bash
npx remotion render packages/video/src/index.ts ReelVertical /tmp/scenes.mp4 --public-dir=public \
  --props='{"subtitles":[],"audioUrl":null,"durationInSeconds":12,"palette":{"accent":"#caff00","ink":"#f4f4f0","paper":"#0d0f10"},"scenes":[{"type":"title_card","startTime":0,"endTime":2,"title":"무릎 통증 잡는 법"},{"type":"content_slide","startTime":2,"endTime":4,"heading":"세 가지만 지키세요","bullets":["발바닥 고르게","무릎 방향 정렬","천천히 내려가기"]},{"type":"emphasis","startTime":4,"endTime":6,"keyword":"두 번째 발가락"},{"type":"list_reveal","startTime":6,"endTime":8,"title":"순서","items":["준비","하강","정지","상승"]},{"type":"quote","startTime":8,"endTime":10,"quote":"무릎은 발끝을 따라간다"},{"type":"conclusion","startTime":10,"endTime":12,"heading":"오늘부터 해보세요","callToAction":"팔로우하고 더 보기"}]}'
for t in 1 3 5 7 9 11; do ffmpeg -v error -ss $t -i /tmp/scenes.mp4 -frames:v 1 -y /tmp/scene-$t.png; done
```

여섯 장을 열어서 글자가 잘리지 않는지, 세로 화면에서 균형이 맞는지 본다. 어긋나면 폭·크기를 조정한다.

- [ ] **Step 7: 커밋**

```bash
git add packages/video/src/scenes packages/video/src/__tests__
git commit -m "feat: add five vertical scene components"
```

---

## Task 3: 규칙 기반 씬 계획

자막 세그먼트를 씬 타입에 배정한다. LLM이 없어도 대본이 여러 씬으로 전개되게 만드는 부분이다.

**Files:**
- Create: `lib/pipeline/scene-plan.ts`
- Test: `lib/__tests__/scene-plan.test.ts`

**Interfaces:**
- Consumes: `SubtitleJSON` (`@studio/video/src/types`)
- Produces:
  - `planSceneTypes(subtitles: SubtitleJSON): SceneDirective['type'][]` — 세그먼트마다 하나씩

**배정 규칙** (위에서부터 먼저 맞는 것):

| 순위 | 조건 | 씬 타입 |
|---|---|---|
| 1 | 첫 세그먼트 | `title_card` |
| 2 | 마지막 세그먼트 (세그먼트가 2개 이상일 때) | `conclusion` |
| 3 | 숫자 목록·`첫째`/`둘째`·쉼표 2개 이상 | `list_reveal` |
| 4 | 따옴표(`"` `'` `「` `『`)를 포함하거나 `라고` 포함 | `quote` |
| 5 | 공백 제거 후 12자 이하 | `emphasis` |
| 6 | 나머지 | `content_slide` |

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/scene-plan.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { planSceneTypes } from '../pipeline/scene-plan';
import type { SubtitleJSON } from '@studio/video/src/types';

const seg = (id: number, text: string) => ({ id, text, start: id, end: id + 1, words: [] });
const subs = (...texts: string[]): SubtitleJSON => texts.map((t, i) => seg(i, t));

describe('planSceneTypes', () => {
  it('opens with a title card', () => {
    expect(planSceneTypes(subs('무릎 통증 잡는 법', '본문입니다'))[0]).toBe('title_card');
  });

  it('closes with a conclusion', () => {
    const plan = planSceneTypes(subs('제목', '본문', '마무리하겠습니다'));
    expect(plan[plan.length - 1]).toBe('conclusion');
  });

  it('gives a single segment only a title card', () => {
    expect(planSceneTypes(subs('한 문장뿐입니다'))).toEqual(['title_card']);
  });

  it('detects a list', () => {
    const plan = planSceneTypes(subs('제목', '첫째 준비, 둘째 하강, 셋째 상승', '끝'));
    expect(plan[1]).toBe('list_reveal');
  });

  it('detects a quote', () => {
    const plan = planSceneTypes(subs('제목', '코치가 "무릎은 발끝을 따라간다"고 했습니다', '끝'));
    expect(plan[1]).toBe('quote');
  });

  it('treats a very short line as emphasis', () => {
    const plan = planSceneTypes(subs('제목', '이게 핵심입니다', '끝'));
    expect(plan[1]).toBe('emphasis');
  });

  it('falls through to a content slide', () => {
    const plan = planSceneTypes(subs('제목', '발바닥을 바닥에 고르게 누르고 천천히 내려가세요', '끝'));
    expect(plan[1]).toBe('content_slide');
  });

  it('returns nothing for no segments', () => {
    expect(planSceneTypes([])).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/scene-plan.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`lib/pipeline/scene-plan.ts`:

```ts
import type { SceneDirective, SubtitleJSON } from '@studio/video/src/types';

type SceneType = SceneDirective['type'];

const LIST = /(첫째|둘째|셋째|[1-9][.)]\s)/;
const QUOTE = /["'「『]|라고/;
const SHORT = 12;

/**
 * LLM 없이 대본을 씬으로 전개한다. 규칙이라 결정론적이고 테스트가 가능하며 API 키가 필요 없다.
 * LLM 경로가 생기면 같은 반환 타입으로 이 함수를 대체하면 된다.
 */
export function planSceneTypes(subtitles: SubtitleJSON): SceneType[] {
  return subtitles.map((segment, index) => {
    if (index === 0) return 'title_card';
    if (index === subtitles.length - 1) return 'conclusion';

    const text = segment.text;
    if (LIST.test(text) || (text.match(/,/g) ?? []).length >= 2) return 'list_reveal';
    if (QUOTE.test(text)) return 'quote';
    if (text.replace(/\s/g, '').length <= SHORT) return 'emphasis';
    return 'content_slide';
  });
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run lib/__tests__/scene-plan.test.ts
npx tsc --noEmit
```

기대: 8개 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/pipeline/scene-plan.ts lib/__tests__/scene-plan.test.ts
git commit -m "feat: assign scene types to subtitle segments by rule"
```

---

## Task 4: 씬 조립 — 계획과 자막을 씬으로

`buildFallbackScenes`가 타이틀 카드 하나만 만들던 것을 세그먼트마다 씬을 만드는 것으로 바꾼다.

**Files:**
- Modify: `lib/pipeline/scenes.ts`
- Test: `lib/__tests__/scenes.test.ts` (기존 파일 수정)

**Interfaces:**
- Consumes: `planSceneTypes` (Task 3), `StyleSheet`, `SceneDirective` (Task 1)
- Produces:
  - `buildScenes(input: { subtitles: SubtitleJSON; script: string; sheet: StyleSheet }): SceneDirective[]`
  - `generateScenes(input: { script: string; subtitles: SubtitleJSON; sheet: StyleSheet }): Promise<SceneDirective[]>` — 반환 타입은 기존과 같다

반환 타입은 기존 `generateScenes`와 같으므로 `lib/engines/remotion.ts`는 손대지 않는다. 계획 2b가 클립아트를 붙일 때 `usedClipart`를 추가로 돌려주도록 바꾼다.

- [ ] **Step 1: 실패하는 테스트 작성**

기존 `lib/__tests__/scenes.test.ts`의 `buildFallbackScenes` 테스트를 `buildScenes`로 옮기고 아래를 추가한다:

```ts

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
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/scenes.test.ts
```

기대: FAIL — `buildScenes` 없음

- [ ] **Step 3: 구현**

`lib/pipeline/scenes.ts`를 다시 쓴다. 세그먼트 텍스트를 씬 타입별 필드로 옮기는 부분이 핵심이다:

```ts
function sceneFromSegment(
  type: SceneType, segment: SubtitleSegment, accent: string,
): SceneDirective {
  const base = { startTime: segment.start, endTime: segment.end, colorAccent: accent };
  const text = segment.text.trim();

  switch (type) {
    case 'title_card':   return { ...base, type, title: truncate(text) };
    case 'conclusion':   return { ...base, type, heading: truncate(text) };
    case 'emphasis':     return { ...base, type, keyword: truncate(text) };
    case 'quote':        return { ...base, type, quote: text.replace(/["'「『」』]/g, '').trim() };
    case 'list_reveal':  return { ...base, type, title: '', items: splitItems(text) };
    case 'content_slide':return { ...base, type, heading: '', bullets: [text] };
  }
}
```

`splitItems`는 `첫째/둘째/셋째`나 쉼표로 나눈다. 빈 항목은 버린다.

자막이 없으면 기존과 같이 타이틀 카드 하나를 5초로 만든다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
```

기대: 전부 PASS. `generateScenes`의 반환 타입이 바뀌었으므로 `lib/engines/remotion.ts`가 `tsc`에서 깨진다 — Task 7에서 고친다. **이 Task에서는 `tsc`가 그 한 곳에서만 깨지는 것을 확인하고 넘어간다.**

- [ ] **Step 5: 커밋**

```bash
git add lib/pipeline/scenes.ts lib/__tests__/scenes.test.ts
git commit -m "feat: build one scene per segment with a matched character"
```

---

## Task 5: learning-store 표본 문턱

`getLearningInsights()`가 good 피드백 **1건만 있어도** "이 조합을 추천합니다"를 반환한다. n=1에서 처방을 내보내는 구조다.

스펙 §12가 근거를 적어두었다: 같은 브랜드의 다른 파이프라인에서 표면 특징 10개를 n=248로 봤을 때 9개가 성과를 구분하지 못했고, 서사 유형 7개를 n=44로 봤을 때 전부 신뢰구간이 겹쳤다. 수백 건으로도 답이 안 나온 질문에 1건으로 답하면 안 된다.

**Files:**
- Modify: `lib/learning-store.ts`
- Test: `lib/__tests__/learning-insights.test.ts`

**Interfaces:**
- Consumes: 기존 `LearningRecord`
- Produces:
  - `RECOMMENDATION_MIN_SAMPLES = 10`
  - `getLearningInsights(format)`의 `signals`는 그대로, `recommendation`만 문턱을 넘을 때 나온다

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/learning-insights.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getLearningInsights, RECOMMENDATION_MIN_SAMPLES } from '../learning-store';
import { store } from '../store';

const record = (i: number, feedback?: 'good' | 'bad') => ({
  id: `l${i}`, jobId: `j${i}`, format: 'format_a' as const,
  createdAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z',
  status: 'completed' as const, script: '대본', referenceCount: 0, referenceNames: [],
  ...(feedback ? { feedback } : {}),
});

async function seed(n: number, good: number) {
  await store.write('learning-records',
    Array.from({ length: n }, (_, i) => record(i, i < good ? 'good' : undefined)));
}

describe('getLearningInsights', () => {
  it('withholds a recommendation below the sample threshold', async () => {
    await seed(3, 1);
    const insights = await getLearningInsights('format_a');
    expect(insights.recommendation).toContain('표본');
  });

  it('still reports observed signals below the threshold', async () => {
    await seed(3, 1);
    const insights = await getLearningInsights('format_a');
    expect(insights.signals.length).toBeGreaterThan(0);
    expect(insights.total).toBe(3);
  });

  it('gives a recommendation once the threshold is met', async () => {
    await seed(RECOMMENDATION_MIN_SAMPLES, RECOMMENDATION_MIN_SAMPLES);
    const insights = await getLearningInsights('format_a');
    expect(insights.recommendation).not.toContain('표본');
  });

  it('counts rated records, not merely stored ones', async () => {
    await seed(RECOMMENDATION_MIN_SAMPLES, 1);
    const insights = await getLearningInsights('format_a');
    expect(insights.recommendation).toContain('표본');
  });
});
```

마지막 테스트가 중요하다 — 문턱은 **평가된 표본** 기준이어야 한다. 저장 건수로 세면 평가 없이 쌓인 기록만으로 처방이 나간다.

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/learning-insights.test.ts
```

기대: FAIL — `RECOMMENDATION_MIN_SAMPLES` 없음

- [ ] **Step 3: 구현**

`lib/learning-store.ts`에서 `getLearningInsights`의 `recommendation` 계산을 바꾼다:

```ts
/**
 * 처방을 내보내기 전에 필요한 최소 평가 건수. 스펙 §12 참고 —
 * 같은 브랜드의 다른 파이프라인은 n=248로도 성과 구분에 실패했다.
 * 이 학습은 생성 품질(얼굴 안정성·립싱크·구도)에 한정하며 콘텐츠 성과를 약속하지 않는다.
 */
export const RECOMMENDATION_MIN_SAMPLES = 10;

const INSUFFICIENT =
  '아직 판단할 표본이 부족합니다. 좋은 결과와 아쉬운 결과가 쌓이면 추천을 시작합니다.';
```

`ratedCount = goodRecords.length + badRecords.length`를 세고, `ratedCount < RECOMMENDATION_MIN_SAMPLES`면 `recommendation`을 `INSUFFICIENT`로 둔다. `signals`는 손대지 않는다 — 관측 사실 나열은 표본 수와 무관하게 정직하다.

`lib/learning-store.ts`가 아직 자체 파일 I/O를 쓰고 있으면 이 Task에서 `store` 인터페이스로 옮긴다 (키 `learning-records`). Global Constraints가 요구한다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
```

기대: 4개 PASS + 전체 통과

- [ ] **Step 5: 커밋**

```bash
git add lib/learning-store.ts lib/__tests__/learning-insights.test.ts
git commit -m "docs: withhold learning recommendations below a sample threshold"
```

---

## Task 6: 끝까지 실행 검증

조각이 아니라 전체가 도는지 본다. 계획 1의 최종 리뷰가 "행복 경로가 한 번도 재생 가능한 릴스를 만든 적이 없다"를 잡아낸 자리다.

**Files:** 없음 (검증만)

**Interfaces:**
- Consumes: 전체 파이프라인

- [ ] **Step 1: 앱과 워커 기동**

```bash
npm run dev
```

다른 터미널에서:

```bash
set -a && . ./.env.local && set +a
WORKER_RUN=1 APP_URL=http://localhost:3000 npx tsx worker/index.ts
```

- [ ] **Step 2: 여러 씬이 나오는 대본으로 생성**

브라우저에서 `localhost:3000/login` → 초대코드 `TEST01` → 아래 대본:

```
무릎 통증 잡는 법을 알려드릴게요.
많은 분들이 무릎이 안쪽으로 모여서 걱정하십니다.
첫째 발바닥 고르게, 둘째 무릎 방향 정렬, 셋째 천천히 내려가기.
이게 핵심입니다.
꾸준히 하시면 건강하게 운동할 수 있습니다.
```

- [ ] **Step 3: 결과를 눈과 귀로 확인**

완성된 영상을 받아 프레임을 뽑는다:

```bash
ffprobe -v error -show_entries stream=codec_type,width,height -of default=noprint_wrappers=1 <받은.mp4>
ffmpeg -i <받은.mp4> -af volumedetect -f null /dev/null 2>&1 | grep mean_volume
for t in 1 4 7 10 13; do ffmpeg -v error -ss $t -i <받은.mp4> -frames:v 1 -y /tmp/e2e-$t.png; done
```

확인할 것:
- 1080×1920, 오디오 스트림 존재, `mean_volume`이 -60 dB보다 큼(무음이 아님)
- 프레임마다 **씬이 다름** — 타이틀 → 본문 → 리스트 → 강조 → 마무리
- 자막이 단어 단위로 강조되고 한글이 조각나지 않음

- [ ] **Step 4: 결과 기록**

관찰한 것을 보고서에 적는다. 씬이 하나만 나오거나 캐릭터가 전혀 없으면 **보고하고 멈춘다** —
그건 Task 5~7의 연결이 끊겼다는 뜻이고, 다음 단계로 넘어가면 원인이 묻힌다.
