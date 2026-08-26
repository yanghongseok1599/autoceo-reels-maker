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
