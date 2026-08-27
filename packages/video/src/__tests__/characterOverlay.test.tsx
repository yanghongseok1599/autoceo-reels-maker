import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReelVertical } from '../ReelVertical';
import type { ReelProps, SceneDirective } from '../types';
import { FALLBACK_PALETTE } from '../types';
import {
  BOX_BOTTOM, BOX_HEIGHT, BOX_WIDTH, ENTRY_RISE, MEASURED,
  characterBoxBounds, characterEntry,
} from '../components/CharacterImage';

// reelBackground.test.tsx와 같은 이유의 모킹 — Remotion 훅과 <Img>는 컴포지션 밖에서 던진다
vi.mock('remotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('remotion')>()),
  useCurrentFrame: () => 30,
  useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 90 }),
  Img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt="" />,
  staticFile: (p: string) => `/static/${p}`,
}));

const scene: SceneDirective = { type: 'title_card', startTime: 0, endTime: 3, title: '제목' };

function markup(props: Partial<ReelProps>): string {
  return renderToStaticMarkup(
    <ReelVertical
      subtitles={[]} audioUrl={null} scenes={[scene]} durationInSeconds={3}
      palette={FALLBACK_PALETTE} {...props}
    />,
  );
}

function imageSources(html: string): string[] {
  const sources: string[] = [];
  const re = /<img[^>]*\ssrc="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) sources.push(m[1]);
  return sources;
}

describe('SceneRouter — 캐릭터 오버레이', () => {
  it('draws the character when the active scene has one', () => {
    const withChar: SceneDirective = { ...scene, characterImageUrl: 'characters/s1.png' };
    expect(imageSources(markup({ scenes: [withChar] }))).toContain('/static/characters/s1.png');
  });

  /** 상대 경로만 staticFile로 감싼다 — 원격 URL은 그대로 나가야 한다 */
  it('passes a remote character url through untouched', () => {
    const remote: SceneDirective = { ...scene, characterImageUrl: 'https://cdn.test/s1.png' };
    expect(imageSources(markup({ scenes: [remote] }))).toContain('https://cdn.test/s1.png');
  });

  it('draws nothing extra when the scene has no character', () => {
    expect(imageSources(markup({}))).toEqual([]);
  });

  /**
   * 렌더된 스타일이 상수를 **그대로** 쓰는지 본다. 리터럴로 적는 이유가 있다 — 기대값을
   * 상수에서 만들면 상수를 바꿔도 양쪽이 같이 움직여 테스트가 안 깨진다.
   */
  it('paints the character with the exact measured box', () => {
    const html = markup({ scenes: [{ ...scene, characterImageUrl: 'characters/s1.png' }] });
    expect(html).toContain('width:620px');
    expect(html).toContain('height:620px');
    expect(html).toContain('object-fit:contain');
    // contain이 남기는 여백을 아래로 몰지 않으면 정사각·가로 원본이 바닥에서 뜬다
    expect(html).toContain('object-position:bottom');
    expect(html).toContain('padding-bottom:0');
  });
});

/**
 * 상자 크기는 취향이 아니라 실측에서 나온 값이라, 값 자체와 **그 값을 고른 이유**를 같이
 * 붙든다. 상수 하나만 바꿔도 여기서 깨져야 한다.
 */
describe('캐릭터 상자 기하', () => {
  it('pins the literal box constants', () => {
    expect(BOX_WIDTH).toBe(620);
    expect(BOX_HEIGHT).toBe(620);
    expect(BOX_BOTTOM).toBe(0);
    expect(ENTRY_RISE).toBe(28);
    expect(characterBoxBounds()).toEqual({ top: 1300, bottom: 1920 });
  });

  it('starts its entry exactly ENTRY_RISE below the resting place', () => {
    expect(characterEntry(0, 30).translateY).toBe(28);
    expect(characterEntry(30, 30).translateY).toBe(0);
  });

  /** 상자는 프레임 바닥에 붙는다 — 캐릭터가 바닥에 서 있어야 한다 */
  it('anchors the box to the bottom of the frame', () => {
    expect(characterBoxBounds().bottom).toBe(MEASURED.frameHeight);
  });

  /**
   * 위끝은 여전히 "항목이 한 줄로 읽히는 목록"의 본문 아래끝(1300)을 지킨다. 흔한 내용에서는
   * 캐릭터가 본문 뒤로 파고들지 않는다.
   */
  it('keeps its top edge at the readable-list body floor', () => {
    expect(characterBoxBounds().top).toBeGreaterThanOrEqual(MEASURED.bodyFloorReadableList);
  });

  /**
   * 상자가 자막 밴드 **안으로** 내려가는 건 실수가 아니라 결정이다. `SceneRouter`가 캐릭터를
   * 본문 글자 아래에 넣고 자막이 zIndex 20으로 그 위에 있어서 겹쳐도 글자가 이기기 때문에
   * 가능해진 것이다. 그 층 구조를 되돌리면 이 테스트가 결정을 다시 꺼내 보게 만든다.
   */
  it('deliberately extends into the subtitle band, which only the layering allows', () => {
    expect(characterBoxBounds().bottom).toBeGreaterThan(MEASURED.subtitleTop3Line);
  });

  /** 캐릭터 뒤에서도 자막 대비가 WCAG AA 큰 글자 기준 위에 있어야 한다 (실측 기반) */
  it('keeps caption contrast above the WCAG AA large-text floor', () => {
    expect(MEASURED.captionContrastOverCharacter)
      .toBeGreaterThanOrEqual(MEASURED.wcagAaLargeText);
  });

  /**
   * 본문 아래끝에는 **상한이 없다** — `splitItems`가 항목 개수만 5로 자르고 길이는 자르지
   * 않는다. 1411은 실제로 본 표본일 뿐이다. 이게 참인 한 "본문 글자 아래에 그린다"는 층
   * 선택은 취소하면 안 되는 결정이다.
   */
  it('documents that the body floor is unbounded, so overlap must stay safe', () => {
    expect(MEASURED.bodyFloorLongItemsSample).toBeGreaterThan(MEASURED.bodyFloorReadableList);
    expect(MEASURED.bodyFloorLongItemsSample).toBeGreaterThan(characterBoxBounds().top);
  });
});
