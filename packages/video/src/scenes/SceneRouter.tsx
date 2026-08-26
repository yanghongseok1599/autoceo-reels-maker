import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Palette, SceneDirective } from '../types';
import { TitleCard } from './TitleCard';
import { ContentSlide } from './ContentSlide';
import { KeywordEmphasis } from './KeywordEmphasis';
import { ListReveal } from './ListReveal';
import { QuoteSlide } from './QuoteSlide';
import { ConclusionSlide } from './ConclusionSlide';

export function findActiveScene(
  scenes: SceneDirective[],
  currentTime: number,
): SceneDirective | undefined {
  return scenes.find((s) => currentTime >= s.startTime && currentTime < s.endTime);
}

/**
 * 씬 타입 → 컴포넌트 분기. SceneRouter 밖으로 뺀 이유는 Remotion 훅 없이 테스트하기 위해서다.
 * `characterImageUrl` 처리는 계획 2b가 붙인다.
 */
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

/**
 * `types.ts`의 `SceneBase.backgroundImageUrl` 주석이 약속한 폴백을 실제로 적용한다:
 * 씬에 배경이 없으면 릴 전체 배경(`ReelProps.backgroundImageUrl`)을 쓴다. 씬 쪽 값이 있으면
 * 그대로 두고, 릴 배경마저 없으면 각 씬 컴포넌트가 팔레트 그라디언트로 대체한다.
 *
 * 폴백을 여기서 먹이는 이유는 씬 컴포넌트가 릴 단위 값을 알 필요가 없기 때문이다 —
 * 컴포넌트는 받은 씬 하나만 그린다.
 */
export function withReelBackground(
  scene: SceneDirective,
  reelBackgroundImageUrl?: string,
): SceneDirective {
  if (scene.backgroundImageUrl || !reelBackgroundImageUrl) return scene;
  return { ...scene, backgroundImageUrl: reelBackgroundImageUrl };
}

export const SceneRouter: React.FC<{
  scenes: SceneDirective[];
  palette: Palette;
  /** 씬에 배경이 없을 때 쓰는 릴 전체 배경 */
  backgroundImageUrl?: string;
}> = ({ scenes, palette, backgroundImageUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = findActiveScene(scenes, frame / fps);
  if (!active) return <AbsoluteFill />;

  return (
    <AbsoluteFill>
      {renderScene(withReelBackground(active, backgroundImageUrl), palette)}
    </AbsoluteFill>
  );
};
