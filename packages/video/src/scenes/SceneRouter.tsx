import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { SceneDirective } from '../types';
import { TitleCard } from './TitleCard';

export function findActiveScene(
  scenes: SceneDirective[],
  currentTime: number,
): SceneDirective | undefined {
  return scenes.find((s) => currentTime >= s.startTime && currentTime < s.endTime);
}

export const SceneRouter: React.FC<{ scenes: SceneDirective[] }> = ({ scenes }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = findActiveScene(scenes, frame / fps);
  return <AbsoluteFill>{active?.type === 'title_card' && <TitleCard scene={active} />}</AbsoluteFill>;
};
