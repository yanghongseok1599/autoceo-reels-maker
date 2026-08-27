import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ReelProps } from './types';
import { SceneRouter } from './scenes/SceneRouter';
import { Subtitles } from './components/Subtitles';
import { CaptionScrim } from './components/CaptionScrim';
import { resolveAudioSrc } from './utils/audioSrc';

export const ReelVertical: React.FC<ReelProps> = ({
  subtitles, audioUrl, scenes, palette, backgroundImageUrl,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.paper }}>
      {audioUrl && <Audio src={resolveAudioSrc(audioUrl)} />}
      <AbsoluteFill style={{ zIndex: 10 }}>
        {/* 릴 전체 배경은 씬에 배경이 없을 때만 쓰인다 — SceneRouter의 withReelBackground */}
        <SceneRouter scenes={scenes} palette={palette} backgroundImageUrl={backgroundImageUrl} />
      </AbsoluteFill>
      {/* 자막 가림막은 씬(10)과 자막(20) 사이다. 씬 안이 아니라 여기 두는 이유는 씬의
          등장·퇴장 페이드를 받지 않기 위해서다 — 자막 밴드의 성격은 릴 내내 같아야 한다. */}
      <AbsoluteFill style={{ zIndex: 15 }}>
        <CaptionScrim palette={palette} />
      </AbsoluteFill>
      <AbsoluteFill style={{ zIndex: 20 }}>
        <Subtitles subtitles={subtitles} currentTime={currentTime} bottom={160} palette={palette} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
