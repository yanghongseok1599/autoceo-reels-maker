import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// vi.mock은 vitest가 import보다 위로 끌어올리므로 아래 정적 import도 모킹된 remotion을 받는다
import { TitleCard } from '../scenes/TitleCard';
import { ContentSlide } from '../scenes/ContentSlide';
import { ConclusionSlide } from '../scenes/ConclusionSlide';
import { FALLBACK_PALETTE } from '../types';

/**
 * Remotion 훅은 <Composition> 안에서만 산다. 프레임과 비디오 설정만 고정해 주면 나머지
 * (spring·interpolate·AbsoluteFill)는 진짜 구현을 그대로 쓴다 — 애니메이션 수치를 가짜로
 * 바꾸면 이 테스트가 검사하려는 화면이 아니게 된다.
 */
const FRAME = 30;
vi.mock('remotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('remotion')>()),
  useCurrentFrame: () => FRAME,
  useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 90 }),
}));

/** 인라인 style 속성을 선언 맵으로 푼다. 그라디언트에는 `;`가 없어 이 분해가 안전하다 */
function styleBlocks(html: string): Record<string, string>[] {
  const blocks: Record<string, string>[] = [];
  const re = /style="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const decls: Record<string, string> = {};
    for (const decl of m[1].split(';')) {
      const colon = decl.indexOf(':');
      if (colon > 0) decls[decl.slice(0, colon).trim()] = decl.slice(colon + 1).trim();
    }
    blocks.push(decls);
  }
  return blocks;
}

const px = (value: string | undefined): number => (value ? parseFloat(value) : NaN);

/** React는 padding을 단축 속성으로 뱉는다. 아래쪽 값만 꺼낸다 */
function bottomPaddingOf(block: Record<string, string> | undefined): number {
  if (!block) return 0;
  if (block['padding-bottom']) return px(block['padding-bottom']);
  const parts = (block.padding ?? '').split(/\s+/).filter(Boolean);
  if (!parts.length) return 0;
  return px(parts[{ 1: 0, 2: 0, 3: 2, 4: 2 }[parts.length] ?? 0]);
}

/**
 * 시청자가 "같은 종류의 카드다"를 판정할 때 실제로 쓰는 축만 뽑는다.
 * 폰트 크기 몇 px 차이 같은 건 일부러 넣지 않는다 — 결함 A의 두 카드는 그것만 달랐고
 * 화면에서는 같은 카드로 읽혔다.
 */
function cardSignature(element: React.ReactElement) {
  const html = renderToStaticMarkup(element);
  const blocks = styleBlocks(html);

  const heading = blocks.reduce((biggest, b) =>
    (px(b['font-size']) || 0) > (px(biggest['font-size']) || 0) ? b : biggest, {} as Record<string, string>);

  // 가로 액센트 룰: 낮고 넓은 막대. 타이틀 카드의 서명이다.
  const hasHorizontalRule = blocks.some((b) => px(b.height) <= 8 && px(b.width) >= 100);
  // 세로 액센트 바: 좁고 높이를 글에 맞춰 늘리는 막대(높이가 인라인에 없다).
  const hasVerticalBar = blocks.some(
    (b) => px(b.width) <= 16 && !b.height && /scaleY/.test(b.transform ?? ''),
  );
  const halo = /(?:ellipse|circle) at ([^,]+),/.exec(blocks[1]?.background ?? '')?.[1] ?? null;

  return {
    textAlign: heading['text-align'] ?? null,
    alignItems: blocks[0]?.['align-items'] ?? null,
    hasHorizontalRule,
    hasVerticalBar,
    halo,
    // 세로 어디에 앉는가. 타이틀 카드는 정중앙, 본문 카드는 위쪽.
    bottomPadding: bottomPaddingOf(blocks[0]),
  };
}

const span = { startTime: 0, endTime: 3 };
const TEXT = '많은 분들이 무릎이 안쪽으로 모여서 걱정하십니다.';

/**
 * 프로덕션에서 실제로 오는 모양으로 비교한다. `subtitle`은 세그먼트가 MAX_HEADLINE을
 * 넘칠 때만 채워지므로 실제 전사에서는 거의 언제나 비고, `bullets`는 40자 이하
 * 세그먼트에서 언제나 빈다(`splitLead`). 즉 아래 두 씬이 두 카드의 **보통 모양**이다.
 */
const titleCard = <TitleCard scene={{ ...span, type: 'title_card', title: TEXT }} palette={FALLBACK_PALETTE} />;
const contentSlide = (
  <ContentSlide scene={{ ...span, type: 'content_slide', heading: TEXT, bullets: [] }} palette={FALLBACK_PALETTE} />
);

describe('content_slide는 title_card와 다른 종류의 카드로 보인다', () => {
  it('불릿이 없는 보통 모양에서도 정렬·액센트·배경 초점·수직 위치가 모두 다르다', () => {
    const title = cardSignature(titleCard);
    const content = cardSignature(contentSlide);

    expect(content.textAlign).not.toBe(title.textAlign);
    expect(content.alignItems).not.toBe(title.alignItems);
    expect(content.halo).not.toBe(title.halo);
    expect(content.bottomPadding).not.toBe(title.bottomPadding);
  });

  it('가로 밑줄 룰은 타이틀 카드만 쓴다 — 본문 카드는 세로 바를 쓴다', () => {
    const title = cardSignature(titleCard);
    const content = cardSignature(contentSlide);

    expect(title.hasHorizontalRule).toBe(true);
    expect(title.hasVerticalBar).toBe(false);
    expect(content.hasHorizontalRule).toBe(false);
    expect(content.hasVerticalBar).toBe(true);
  });

  it('본문 카드의 정체성이 bullets에 걸려 있지 않다', () => {
    // 불릿이 있든 없든 카드를 구별짓는 요소는 그대로여야 한다. 결함 A는 정확히 이게
    // 깨져 있어서 생겼다 — 구별 요소가 bullets 안에만 있었고 bullets는 보통 비어 있었다.
    const empty = cardSignature(contentSlide);
    const filled = cardSignature(
      <ContentSlide
        scene={{ ...span, type: 'content_slide', heading: TEXT, bullets: ['발바닥 고르게'] }}
        palette={FALLBACK_PALETTE}
      />,
    );

    expect(empty).toEqual(filled);
  });

  /**
   * 결함 B는 표제에서 잡았지만, 표제 아래 **둘째 줄**은 오래 비어 있어 아무도 보지 않았다.
   * 넘친 꼬리가 그 줄로 들어오기 시작하면 같은 결함이 자리만 옮겨 되살아난다.
   * 그래서 두 카드에서 글자를 그리는 블록을 **전부** 훑는다.
   */
  it('표제 아래 둘째 줄도 어절을 쪼개지 않는다', () => {
    const withSecondLine = [
      <TitleCard
        key="t"
        scene={{ ...span, type: 'title_card', title: TEXT, subtitle: '알려 드릴게요' }}
        palette={FALLBACK_PALETTE}
      />,
      <ConclusionSlide
        key="c"
        scene={{ ...span, type: 'conclusion', heading: TEXT, callToAction: '알려 드릴게요' }}
        palette={FALLBACK_PALETTE}
      />,
    ];

    for (const element of withSecondLine) {
      const textBlocks = styleBlocks(renderToStaticMarkup(element)).filter((b) => b['font-size']);
      expect(textBlocks.length).toBeGreaterThanOrEqual(2);
      for (const block of textBlocks) expect(block['word-break']).toBe('keep-all');
    }
  });

  it('두 카드 모두 한국어 어절을 어절 한가운데서 쪼개지 않는다', () => {
    // 결함 B: TitleCard만 keep-all이 없어 첫 프레임에서 `알려 드` / `릴게요.`로 갈렸다.
    for (const element of [titleCard, contentSlide]) {
      const heading = styleBlocks(renderToStaticMarkup(element))
        .reduce((biggest, b) => (px(b['font-size']) || 0) > (px(biggest['font-size']) || 0) ? b : biggest,
          {} as Record<string, string>);
      expect(heading['word-break']).toBe('keep-all');
    }
  });
});
