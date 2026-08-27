import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReelVertical } from '../ReelVertical';
import type { ReelProps, SceneDirective } from '../types';
import { FALLBACK_PALETTE } from '../types';

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
   * 캐릭터는 자막을 덮으면 안 된다. 상자 바닥(1920 - 400 = 1520)이 세 줄 자막 라인박스
   * 상단(1549.7)보다 위에 있어야 한다 — 실측으로 고른 값이 코드에 그대로 남아 있는지 본다.
   */
  it('keeps the character box clear of the three-line subtitle band', () => {
    const html = markup({ scenes: [{ ...scene, characterImageUrl: 'characters/s1.png' }] });
    const bottom = /padding-bottom:(\d+)px[^"]*"[^>]*><img[^>]*characters/.exec(html)
      ?? /padding-bottom:400px/.exec(html);
    expect(bottom).not.toBeNull();
    expect(html).toContain('height:290px');
    expect(html).toContain('object-fit:contain');
  });
});
