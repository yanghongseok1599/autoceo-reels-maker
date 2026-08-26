import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ReelProps } from './types';
import { SceneRouter } from './scenes/SceneRouter';
import { Subtitles } from './components/Subtitles';
import { resolveAudioSrc } from './utils/audioSrc';

export const ReelVertical: React.FC<ReelProps> = ({ subtitles, audioUrl, scenes, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.paper }}>
      {audioUrl && <Audio src={resolveAudioSrc(audioUrl)} />}
      <AbsoluteFill style={{ zIndex: 10 }}><SceneRouter scenes={scenes} palette={palette} /></AbsoluteFill>
      <AbsoluteFill style={{ zIndex: 20 }}>
        <Subtitles subtitles={subtitles} currentTime={currentTime} bottom={160} palette={palette} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
