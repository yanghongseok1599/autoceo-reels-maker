import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { Palette, TitleCardScene } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

export const TitleCard: React.FC<{
  scene: TitleCardScene; palette: Palette;
  /**
   * 배경 위, 본문 글자 아래에 그릴 레이어 (캐릭터 오버레이).
   * 이 씬이 루트에 건 `scale` 배율을 넘겨준다 — 받는 쪽이 그걸 되돌려 프레임 좌표에
   * 그대로 앉을 수 있도록. 씬 글자에 걸린 변형은 그대로 두고 이 슬롯만 면제하는 방법이다.
   */
  underlay?: (sceneScale: number) => React.ReactNode;
}> = ({ scene, palette, underlay }) => {
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

      {/* 배경과 본문 **사이**. 캐릭터가 여기 들어가야 본문 글자가 캐릭터를 덮는다 —
          겹치면 잃는 쪽이 캐릭터여야지 글자여서는 안 된다. SceneRouter 주석 참고. */}
      {underlay?.(exitScale)}

      <div style={{
        position: 'relative',
        fontSize: 72, fontWeight: 900, fontFamily: "'Pretendard', sans-serif",
        color: palette.ink, textAlign: 'center', maxWidth: 920, lineHeight: 1.2, padding: '0 60px',
        // 한국어 기본 줄바꿈은 음절 단위라 넘치지는 않지만 어절 한가운데를 끊는다
        // (`알려 드` / `릴게요.`). 릴스에서 가장 오래 보이는 첫 프레임이라 형제 컴포넌트와
        // 같은 규칙을 쓴다: 어절은 붙여 두고, 한 어절이 줄보다 길 때만 쪼갠다.
        wordBreak: 'keep-all', overflowWrap: 'break-word',
        transform: `scale(${interpolate(titleSpring, [0, 1], [0.8, 1])})`,
        textShadow: `0 4px 40px ${accent}60, 0 2px 8px ${palette.paper}cc`,
      }}>{scene.title}</div>

      {scene.subtitle && (
        <div style={{
          position: 'relative',
          fontSize: 32, fontWeight: 500, fontFamily: "'Pretendard', sans-serif",
          color: `${accent}cc`, textAlign: 'center', maxWidth: 860, lineHeight: 1.4,
          // 제목과 같은 규칙이다. 이 줄은 오래 비어 있었지만 이제 넘친 꼬리가 들어온다 —
          // keep-all이 없으면 `알려 드`/`릴게요.` 가 둘째 줄로 자리만 옮겨 되살아난다.
          wordBreak: 'keep-all', overflowWrap: 'break-word',
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
