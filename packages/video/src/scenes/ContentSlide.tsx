import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { ContentSlideScene, Palette } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

/**
 * 본문 카드. 이 컴포넌트의 요구사항은 **`title_card`와 같은 화면으로 읽히지 않는 것**이다.
 *
 * `bullets`가 빈 배열인 건 예외가 아니라 보통 상태다. `lib/pipeline/scenes.ts`의 `splitLead`는
 * 40자를 넘는 절에서만 꼬리를 불릿으로 밀어내는데, 한국어 whisper 세그먼트는 대부분 그보다
 * 짧다(검증 실행의 실제 세그먼트 8개 중 5개가 40자 이하). 그러니 카드의 정체성을 불릿에
 * 걸면 안 된다 — 불릿이 없어도 타이틀 카드와 다른 종류의 카드로 보여야 한다.
 *
 * 그래서 타이틀 카드와 네 축을 전부 다르게 둔다:
 *   1) 정렬      가운데      → 왼쪽
 *   2) 액센트    글 아래 가로 룰 → 글 왼쪽 세로 바 (같은 타이밍, 반대 축)
 *   3) 배경 초점 화면 정중앙  → 좌상단
 *   4) 수직 위치 화면 정중앙  → 위쪽 1/3
 *   5) 등장 모션 스케일 업    → 왼쪽에서 밀려 들어옴
 * 씬 프레임 계산과 등장·퇴장 처리는 형제 컴포넌트와 동일하게 `utils/animations`를 쓴다.
 */
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
  // 타이틀 카드의 가로 룰이 자라던 자리를 세로 바가 대신한다. 높이는 글 높이를 따라가므로
  // (align-items: stretch) 픽셀이 아니라 scaleY로 키운다.
  const barGrow = interpolate(sceneFrame, [3, 20], [0, 1], {
    extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center',
        // 아래쪽 패딩이 블록을 화면 위쪽 1/3으로 밀어 올린다 — 타이틀 카드는 정중앙에 앉는다.
        // 자막 밴드는 y≥1633에서 시작하므로 불릿이 다 붙어도 겹치지 않는다.
        padding: '0 96px 460px', opacity,
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
          // 초점을 좌상단으로 옮긴다 — 가운데 헤일로는 타이틀 카드의 것이다
          background: `radial-gradient(ellipse at 24% 34%, ${accent}2e 0%, ${palette.paper}f2 60%)`,
        }} />
      )}

      <div style={{
        position: 'relative',
        display: 'flex', alignItems: 'stretch', gap: 32, maxWidth: 888,
        transform: `translateX(${interpolate(headingSpring, [0, 1], [-48, 0])}px)`,
      }}>
        <div style={{
          width: 10, borderRadius: 5, flexShrink: 0,
          background: `linear-gradient(180deg, ${accent}, ${accent}33)`,
          boxShadow: `0 0 24px ${accent}66`,
          transform: `scaleY(${barGrow})`, transformOrigin: 'top',
        }} />

        {/* 아래 여백이 세로 바를 글보다 길게 늘여(align-items: stretch) 빈 하단을 향한
            척추처럼 보이게 한다 — 글 높이에 딱 맞춘 바는 밑줄처럼 읽힌다 */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 24, minWidth: 0, paddingBottom: 120,
        }}>
          <div style={{
            fontSize: 58, fontWeight: 800, fontFamily: "'Pretendard', sans-serif",
            color: palette.ink, textAlign: 'left', lineHeight: 1.4,
            wordBreak: 'keep-all', overflowWrap: 'break-word',
            // flex 자식의 기본 min-width:auto는 min-content로 풀린다. overflow-wrap은
            // min-content 크기를 줄이지 않으므로 이게 없으면 긴 한글 덩어리가 프레임을 넘는다.
            minWidth: 0,
            textShadow: `0 2px 24px ${accent}4d, 0 2px 8px ${palette.paper}cc`,
          }}>{scene.heading}</div>

          {scene.bullets.length > 0 && (
            <div style={{
              display: 'flex', flexDirection: 'column', gap: 20,
              opacity: bodyOpacity, transform: `translateY(${bodyY}px)`,
            }}>
              {scene.bullets.map((bullet, i) => (
                <div key={`${i}-${bullet}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 20 }}>
                  <div style={{
                    width: 14, height: 14, borderRadius: 7, marginTop: 18, flexShrink: 0,
                    background: accent, boxShadow: `0 0 16px ${accent}80`,
                  }} />
                  <div style={{
                    fontSize: 38, fontWeight: 600, fontFamily: "'Pretendard', sans-serif",
                    color: palette.ink, lineHeight: 1.4, wordBreak: 'keep-all', overflowWrap: 'break-word',
                    minWidth: 0,
                    textShadow: `0 2px 12px ${palette.paper}e6`,
                  }}>{bullet}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AbsoluteFill>
  );
};
