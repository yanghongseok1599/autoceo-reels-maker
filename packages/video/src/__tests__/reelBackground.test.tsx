import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
// vi.mock은 vitest가 import보다 위로 끌어올리므로 아래 정적 import도 모킹된 remotion을 받는다
import { ReelVertical } from '../ReelVertical';
import type { ReelProps, SceneDirective } from '../types';
import { FALLBACK_PALETTE } from '../types';

/**
 * Remotion 훅은 <Composition> 안에서만 산다. 프레임과 비디오 설정만 고정해 준다.
 *
 * `<Img>`도 함께 갈아 끼운다. 진짜 구현은 모듈 내부 바인딩으로 `useCurrentFrame`을 부르기
 * 때문에 위 훅 모킹이 닿지 않아 컴포지션 밖에서는 던진다. 여기서 보려는 건 이미지 로딩이
 * 아니라 **어떤 경로가 씬 컴포넌트까지 내려오는가**이므로, src를 그대로 흘려보내는
 * <img>로 충분하다.
 */
vi.mock('remotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('remotion')>()),
  useCurrentFrame: () => 30,
  useVideoConfig: () => ({ fps: 30, width: 1080, height: 1920, durationInFrames: 90 }),
  Img: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt="" />,
}));

const scene: SceneDirective = { type: 'title_card', startTime: 0, endTime: 3, title: '제목' };

function markup(props: Partial<ReelProps>): string {
  return renderToStaticMarkup(
    <ReelVertical
      subtitles={[]}
      audioUrl={null}
      scenes={[scene]}
      durationInSeconds={3}
      palette={FALLBACK_PALETTE}
      {...props}
    />,
  );
}

/** src="…" 로 실제 화면에 붙은 이미지 경로만 뽑는다 */
function imageSources(html: string): string[] {
  const sources: string[] = [];
  const re = /<img[^>]*\ssrc="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) sources.push(m[1]);
  return sources;
}

/**
 * types.ts의 `SceneBase.backgroundImageUrl` 주석이 "없으면 ReelProps.backgroundImageUrl을
 * 쓴다"고 약속한다. 예전에는 ReelVertical이 그 prop을 아예 읽지 않아서
 * lib/engines/remotion.ts가 계산해 넘긴 값이 아무 데도 닿지 않았다.
 */
describe('ReelVertical — 릴 전체 배경', () => {
  it('hands the reel background down to a scene that has none', () => {
    expect(imageSources(markup({ backgroundImageUrl: '/reel.png' }))).toContain('/reel.png');
  });

  it('lets a scene keep its own background', () => {
    const own: SceneDirective = { ...scene, backgroundImageUrl: '/scene.png' };
    const sources = imageSources(markup({ scenes: [own], backgroundImageUrl: '/reel.png' }));
    expect(sources).toContain('/scene.png');
    expect(sources).not.toContain('/reel.png');
  });

  it('draws no background image when neither level has one', () => {
    expect(imageSources(markup({}))).toEqual([]);
  });
});
