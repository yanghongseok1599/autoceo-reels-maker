import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { Palette, TitleCardScene } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

export const TitleCard: React.FC<{ scene: TitleCardScene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrame = frame - Math.round(scene.startTime * fps);
  const sceneDuration = Math.round((scene.endTime - scene.startTime) * fps);
  const accent = scene.colorAccent ?? palette.accent;

  const titleSpring = spring({ frame: sceneFrame, fps, config: SPRING_PRESETS.gentle });
  const opacity = getEntryExitOpacity(sceneFrame, sceneDuration);
  const exitBlur = getExitBlur(sceneFrame, sceneDuration);
  const exitScale = getEntryExitScale(sceneFrame, sceneDuration, fps, 0.8, 1.08);
  const subOpacity = interpolate(sceneFrame, [10, 20], [0, 1], { extrapolateRight: 'clamp' });
  const subY = interpolate(sceneFrame, [10, 25], [30, 0], { extrapolateRight: 'clamp' });
  const lineWidth = interpolate(sceneFrame, [5, 20], [0, 240], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 24, opacity,
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

      <div style={{
        position: 'relative',
        fontSize: 72, fontWeight: 900, fontFamily: "'Pretendard', sans-serif",
        color: palette.ink, textAlign: 'center', maxWidth: 920, lineHeight: 1.2, padding: '0 60px',
        transform: `scale(${interpolate(titleSpring, [0, 1], [0.8, 1])})`,
        textShadow: `0 4px 40px ${accent}60, 0 2px 8px ${palette.paper}cc`,
      }}>{scene.title}</div>

      {scene.subtitle && (
        <div style={{
          position: 'relative',
          fontSize: 32, fontWeight: 500, fontFamily: "'Pretendard', sans-serif",
          color: `${accent}cc`, textAlign: 'center', maxWidth: 860, lineHeight: 1.4,
          opacity: subOpacity, transform: `translateY(${subY}px)`,
        }}>{scene.subtitle}</div>
      )}

      <div style={{
        position: 'relative',
        width: lineWidth, height: 4, borderRadius: 2, marginTop: 16,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
      }} />
    </AbsoluteFill>
  );
};
