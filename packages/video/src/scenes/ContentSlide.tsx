import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { ContentSlideScene, Palette } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

export const ContentSlide: React.FC<{ scene: ContentSlideScene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrame = frame - Math.round(scene.startTime * fps);
  const sceneDuration = Math.round((scene.endTime - scene.startTime) * fps);
  const accent = scene.colorAccent ?? palette.accent;

  const headingSpring = spring({ frame: sceneFrame, fps, config: SPRING_PRESETS.gentle });
  const opacity = getEntryExitOpacity(sceneFrame, sceneDuration);
  const exitBlur = getExitBlur(sceneFrame, sceneDuration);
  const exitScale = getEntryExitScale(sceneFrame, sceneDuration, fps, 0.92, 1.04);
  const bodyOpacity = interpolate(sceneFrame, [10, 22], [0, 1], { extrapolateRight: 'clamp' });
  const bodyY = interpolate(sceneFrame, [10, 26], [30, 0], { extrapolateRight: 'clamp' });
  const ruleWidth = interpolate(sceneFrame, [5, 20], [0, 200], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 28, opacity,
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
        fontSize: 64, fontWeight: 900, fontFamily: "'Pretendard', sans-serif",
        color: palette.ink, textAlign: 'center', maxWidth: 920, lineHeight: 1.25,
        padding: '0 60px', wordBreak: 'keep-all', overflowWrap: 'break-word',
        transform: `scale(${interpolate(headingSpring, [0, 1], [0.86, 1])})`,
        textShadow: `0 4px 40px ${accent}60, 0 2px 8px ${palette.paper}cc`,
      }}>{scene.heading}</div>

      <div style={{
        position: 'relative',
        width: ruleWidth, height: 4, borderRadius: 2,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
      }} />

      <div style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 24,
        maxWidth: 920, padding: '0 60px', marginTop: 8,
        opacity: bodyOpacity, transform: `translateY(${bodyY}px)`,
      }}>
        {scene.bullets.map((bullet, i) => (
          <div key={`${i}-${bullet}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
            <div style={{
              width: 14, height: 14, borderRadius: 7, marginTop: 20, flexShrink: 0,
              background: accent, boxShadow: `0 0 16px ${accent}80`,
            }} />
            <div style={{
              fontSize: 40, fontWeight: 600, fontFamily: "'Pretendard', sans-serif",
              color: palette.ink, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'break-word',
              textShadow: `0 2px 12px ${palette.paper}e6`,
            }}>{bullet}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
