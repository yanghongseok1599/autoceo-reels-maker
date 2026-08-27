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
    expect(html).toContain('width:360px');
    expect(html).toContain('height:200px');
    expect(html).toContain('object-fit:contain');
    expect(html).toContain('padding-bottom:420px');
  });
});

/**
 * 상자 크기는 취향이 아니라 실측에서 나온 값이라, 값 자체와 **그 값을 고른 이유**를 같이
 * 붙든다. 상수 하나만 바꿔도 여기서 깨져야 한다.
 */
describe('캐릭터 상자 기하', () => {
  it('pins the literal box constants', () => {
    expect(BOX_WIDTH).toBe(360);
    expect(BOX_HEIGHT).toBe(200);
    expect(BOX_BOTTOM).toBe(420);
    expect(ENTRY_RISE).toBe(28);
    expect(characterBoxBounds()).toEqual({ top: 1300, bottom: 1500 });
  });

  it('starts its entry exactly ENTRY_RISE below the resting place', () => {
    expect(characterEntry(0, 30).translateY).toBe(28);
    expect(characterEntry(30, 30).translateY).toBe(0);
  });

  /** 제자리에서는 세 줄 자막 밴드 위에 있어야 한다 */
  it('rests clear of the three-line subtitle band', () => {
    expect(characterBoxBounds().bottom).toBeLessThan(MEASURED.subtitleTop3Line);
    expect(MEASURED.subtitleTop3Line - characterBoxBounds().bottom).toBeGreaterThanOrEqual(40);
  });

  /** 등장 도중 가장 아래로 내려간 순간에도 자막을 건드리지 않아야 한다 */
  it('stays clear of the subtitles while rising', () => {
    expect(characterBoxBounds().bottom + ENTRY_RISE).toBeLessThan(MEASURED.subtitleTop3Line);
  });

  /** 항목이 한 줄로 읽히는 목록(실측 아래끝 1300)까지는 본문과 겹치지 않아야 한다 */
  it('clears the readable-list body floor', () => {
    expect(characterBoxBounds().top).toBeGreaterThanOrEqual(MEASURED.bodyFloorReadableList);
  });

  /**
   * 파이프라인 최대치(1411)는 **못 피한다**는 사실 자체를 붙든다. 이게 참인 한
   * "본문 글자 아래에 그린다"는 층 선택은 취소하면 안 되는 결정이다.
   */
  it('documents that no box size can clear the pipeline maximum', () => {
    expect(MEASURED.bodyFloorPipelineMax).toBeGreaterThan(characterBoxBounds().top);
    const roomAtMax = MEASURED.subtitleTop3Line - MEASURED.bodyFloorPipelineMax;
    expect(roomAtMax).toBeLessThan(BOX_HEIGHT);
  });
});
