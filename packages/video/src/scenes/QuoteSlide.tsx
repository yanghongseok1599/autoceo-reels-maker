import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { Palette, QuoteScene } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

export const QuoteSlide: React.FC<{ scene: QuoteScene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrame = frame - Math.round(scene.startTime * fps);
  const sceneDuration = Math.round((scene.endTime - scene.startTime) * fps);
  const accent = scene.colorAccent ?? palette.accent;

  const quoteSpring = spring({ frame: sceneFrame, fps, config: SPRING_PRESETS.gentle });
  const opacity = getEntryExitOpacity(sceneFrame, sceneDuration);
  const exitBlur = getExitBlur(sceneFrame, sceneDuration);
  const exitScale = getEntryExitScale(sceneFrame, sceneDuration, fps, 0.94, 1.03);
  const markOpacity = interpolate(sceneFrame, [0, 14], [0, 1], { extrapolateRight: 'clamp' });
  const authorOpacity = interpolate(sceneFrame, [14, 26], [0, 1], { extrapolateRight: 'clamp' });
  const authorY = interpolate(sceneFrame, [14, 30], [20, 0], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 20, opacity,
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
        fontSize: 140, fontWeight: 900, fontFamily: "'Pretendard', sans-serif",
        color: accent, lineHeight: 0.8, opacity: markOpacity * 0.55,
      }}>&ldquo;</div>

      <div style={{
        position: 'relative',
        fontSize: 52, fontWeight: 700, fontFamily: "'Pretendard', sans-serif",
        color: palette.ink, textAlign: 'center', maxWidth: 920, lineHeight: 1.5,
        padding: '0 60px', wordBreak: 'keep-all', overflowWrap: 'break-word',
        transform: `scale(${interpolate(quoteSpring, [0, 1], [0.9, 1])})`,
        textShadow: `0 4px 30px ${accent}4d, 0 2px 10px ${palette.paper}cc`,
      }}>{scene.quote}</div>

      <div style={{
        position: 'relative',
        width: 160, height: 3, borderRadius: 2, marginTop: 24,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        opacity: authorOpacity,
      }} />

      {scene.author && (
        <div style={{
          position: 'relative',
          fontSize: 32, fontWeight: 600, fontFamily: "'Pretendard', sans-serif",
          color: `${accent}cc`, textAlign: 'center', maxWidth: 860, lineHeight: 1.4,
          padding: '0 60px', wordBreak: 'keep-all', overflowWrap: 'break-word',
          opacity: authorOpacity, transform: `translateY(${authorY}px)`,
        }}>&mdash; {scene.author}</div>
      )}
    </AbsoluteFill>
  );
};
