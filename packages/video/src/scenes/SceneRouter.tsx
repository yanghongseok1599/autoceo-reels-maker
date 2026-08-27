import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Palette, SceneDirective } from '../types';
import { TitleCard } from './TitleCard';
import { ContentSlide } from './ContentSlide';
import { KeywordEmphasis } from './KeywordEmphasis';
import { ListReveal } from './ListReveal';
import { QuoteSlide } from './QuoteSlide';
import { ConclusionSlide } from './ConclusionSlide';
import { CharacterImage } from '../components/CharacterImage';

export function findActiveScene(
  scenes: SceneDirective[],
  currentTime: number,
): SceneDirective | undefined {
  return scenes.find((s) => currentTime >= s.startTime && currentTime < s.endTime);
}

/**
 * 씬 타입 → 컴포넌트 분기. SceneRouter 밖으로 뺀 이유는 Remotion 훅 없이 테스트하기 위해서다.
 * `characterImageUrl`은 여기서 그리지 않는다 — 씬 컴포넌트 **위에** 얹는 오버레이라
 * SceneRouter가 형제로 붙인다.
 */
export function renderScene(scene: SceneDirective, palette: Palette): React.ReactNode {
  switch (scene.type) {
    case 'title_card': return <TitleCard scene={scene} palette={palette} />;
    case 'content_slide': return <ContentSlide scene={scene} palette={palette} />;
    case 'emphasis': return <KeywordEmphasis scene={scene} palette={palette} />;
    case 'list_reveal': return <ListReveal scene={scene} palette={palette} />;
    case 'quote': return <QuoteSlide scene={scene} palette={palette} />;
    case 'conclusion': return <ConclusionSlide scene={scene} palette={palette} />;
    default: return null;
  }
}

/**
 * `types.ts`의 `SceneBase.backgroundImageUrl` 주석이 약속한 폴백을 실제로 적용한다:
 * 씬에 배경이 없으면 릴 전체 배경(`ReelProps.backgroundImageUrl`)을 쓴다. 씬 쪽 값이 있으면
 * 그대로 두고, 릴 배경마저 없으면 각 씬 컴포넌트가 팔레트 그라디언트로 대체한다.
 *
 * 폴백을 여기서 먹이는 이유는 씬 컴포넌트가 릴 단위 값을 알 필요가 없기 때문이다 —
 * 컴포넌트는 받은 씬 하나만 그린다.
 */
export function withReelBackground(
  scene: SceneDirective,
  reelBackgroundImageUrl?: string,
): SceneDirective {
  if (scene.backgroundImageUrl || !reelBackgroundImageUrl) return scene;
  return { ...scene, backgroundImageUrl: reelBackgroundImageUrl };
}

/**
 * 캐릭터 등장 모션의 기준 시각. 활성 씬의 `startTime`이 아니라 **같은 캐릭터가 연속으로
 * 이어지는 구간의 첫 씬**의 `startTime`이다.
 *
 * 씬마다 기준을 새로 잡으면, 릴 전체에 같은 캐릭터를 붙이는 보통의 경우(학생 한 명 =
 * 캐릭터 한 장)에 씬이 바뀔 때마다 캐릭터가 사라졌다 다시 올라온다 — 3초마다 깜빡인다.
 * 반대로 전역 프레임을 쓰면 캐릭터가 중간 씬에서 처음 나타날 때 모션 없이 튀어나오고,
 * 씬마다 다른 캐릭터를 쓰는 경우에는 교체가 통째로 무시된다.
 *
 * 그림이 **바뀐 시점**을 기준으로 삼으면 두 경우가 다 맞는다: 같은 그림이 이어지면 처음
 * 한 번만 올라오고, 그림이 바뀌면 그 씬에서 다시 올라온다.
 */
export function characterRunStart(scenes: SceneDirective[], activeIndex: number): number {
  const active = scenes[activeIndex];
  if (!active) return 0;
  let first = activeIndex;
  while (first > 0 && scenes[first - 1].characterImageUrl === active.characterImageUrl) {
    first -= 1;
  }
  return scenes[first].startTime;
}

export const SceneRouter: React.FC<{
  scenes: SceneDirective[];
  palette: Palette;
  /** 씬에 배경이 없을 때 쓰는 릴 전체 배경 */
  backgroundImageUrl?: string;
}> = ({ scenes, palette, backgroundImageUrl }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = findActiveScene(scenes, frame / fps);
  if (!active) return <AbsoluteFill />;

  return (
    <AbsoluteFill>
      {renderScene(withReelBackground(active, backgroundImageUrl), palette)}
      {/* 캐릭터는 씬 위, 자막 아래다. ReelVertical이 자막을 zIndex 20에 따로 얹으므로
          혹시 겹치더라도 글자가 이긴다. */}
      {active.characterImageUrl && (
        <CharacterImage
          src={active.characterImageUrl}
          startTime={characterRunStart(scenes, scenes.indexOf(active))}
        />
      )}
    </AbsoluteFill>
  );
};
