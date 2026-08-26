import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { ListRevealScene, Palette } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

/** 항목 i는 sceneFrame이 i * STAGGER_FRAMES를 넘을 때부터 나타난다 */
const STAGGER_FRAMES = 8;

export const ListReveal: React.FC<{ scene: ListRevealScene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrame = frame - Math.round(scene.startTime * fps);
  const sceneDuration = Math.round((scene.endTime - scene.startTime) * fps);
  const accent = scene.colorAccent ?? palette.accent;

  const titleSpring = spring({ frame: sceneFrame, fps, config: SPRING_PRESETS.gentle });
  const opacity = getEntryExitOpacity(sceneFrame, sceneDuration);
  const exitBlur = getExitBlur(sceneFrame, sceneDuration);
  const exitScale = getEntryExitScale(sceneFrame, sceneDuration, fps, 0.92, 1.04);

  const itemOpacity = (i: number) =>
    interpolate(sceneFrame, [i * STAGGER_FRAMES, i * STAGGER_FRAMES + 10], [0, 1], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });
  const itemX = (i: number) =>
    interpolate(sceneFrame, [i * STAGGER_FRAMES, i * STAGGER_FRAMES + 12], [-40, 0], {
      extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
    });

  return (
    <AbsoluteFill
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 40, opacity,
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
        transform: `scale(${interpolate(titleSpring, [0, 1], [0.86, 1])})`,
        textShadow: `0 4px 40px ${accent}60, 0 2px 8px ${palette.paper}cc`,
      }}>{scene.title}</div>

      <div style={{
        position: 'relative',
        display: 'flex', flexDirection: 'column', gap: 24,
        maxWidth: 920, padding: '0 60px',
      }}>
        {scene.items.map((item, i) => (
          <div key={`${i}-${item}`} style={{
            display: 'flex', alignItems: 'center', gap: 24,
            opacity: itemOpacity(i), transform: `translateX(${itemX(i)}px)`,
          }}>
            <div style={{
              width: 56, height: 56, borderRadius: 28, flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `${accent}26`, border: `3px solid ${accent}`,
              fontSize: 28, fontWeight: 900, fontFamily: "'Pretendard', sans-serif",
              color: accent,
            }}>{i + 1}</div>
            <div style={{
              fontSize: 40, fontWeight: 600, fontFamily: "'Pretendard', sans-serif",
              color: palette.ink, lineHeight: 1.35, wordBreak: 'keep-all', overflowWrap: 'break-word',
              textShadow: `0 2px 12px ${palette.paper}e6`,
            }}>{item}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
