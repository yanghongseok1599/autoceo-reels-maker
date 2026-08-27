import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { EmphasisScene, Palette } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

export const KeywordEmphasis: React.FC<{
  scene: EmphasisScene; palette: Palette;
  /** 배경 위, 본문 글자 아래에 그릴 레이어 (캐릭터 오버레이) */
  underlay?: React.ReactNode;
}> = ({ scene, palette, underlay }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrame = frame - Math.round(scene.startTime * fps);
  const sceneDuration = Math.round((scene.endTime - scene.startTime) * fps);
  const accent = scene.colorAccent ?? palette.accent;

  const keywordSpring = spring({ frame: sceneFrame, fps, config: SPRING_PRESETS.gentle });
  const opacity = getEntryExitOpacity(sceneFrame, sceneDuration);
  const exitBlur = getExitBlur(sceneFrame, sceneDuration);
  const exitScale = getEntryExitScale(sceneFrame, sceneDuration, fps, 0.7, 1.12);
  const contextOpacity = interpolate(sceneFrame, [12, 24], [0, 1], { extrapolateRight: 'clamp' });
  const contextY = interpolate(sceneFrame, [12, 28], [24, 0], { extrapolateRight: 'clamp' });
  const glow = interpolate(sceneFrame, [0, 18], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 32, opacity,
        filter: exitBlur > 0 ? `blur(${exitBlur}px)` : undefined,
        transform: `scale(${exitScale})`,
      }}
    >
      {/* 배경: AI 생성 이미지가 있으면 깔고, 없으면 팔레트 그라디언트로 대체 */}
      {scene.backgroundImageUrl ? (
        <AbsoluteFill>
          <Img src={scene.backgroundImageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: `${palette.paper}73` }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{
          background: `radial-gradient(ellipse at center, ${accent}25 0%, ${palette.paper}f2 70%)`,
        }} />
      )}

      {/* 배경과 본문 **사이**. 캐릭터가 여기 들어가야 본문 글자가 캐릭터를 덮는다 —
          겹치면 잃는 쪽이 캐릭터여야지 글자여서는 안 된다. SceneRouter 주석 참고. */}
      {underlay}

      <div style={{
        position: 'relative',
        fontSize: 108, fontWeight: 900, fontFamily: "'Pretendard', sans-serif",
        color: accent, textAlign: 'center', maxWidth: 920, lineHeight: 1.15,
        padding: '0 60px', wordBreak: 'keep-all', overflowWrap: 'break-word', letterSpacing: '-0.02em',
        transform: `scale(${interpolate(keywordSpring, [0, 1], [0.7, 1])})`,
        textShadow: `0 6px ${40 * glow}px ${accent}66, 0 2px 10px ${palette.paper}`,
      }}>{scene.keyword}</div>

      {scene.context && (
        <div style={{
          position: 'relative',
          fontSize: 40, fontWeight: 600, fontFamily: "'Pretendard', sans-serif",
          color: palette.ink, textAlign: 'center', maxWidth: 860, lineHeight: 1.4,
          padding: '0 60px', wordBreak: 'keep-all', overflowWrap: 'break-word',
          opacity: contextOpacity, transform: `translateY(${contextY}px)`,
          textShadow: `0 2px 12px ${palette.paper}e6`,
        }}>{scene.context}</div>
      )}
    </AbsoluteFill>
  );
};
