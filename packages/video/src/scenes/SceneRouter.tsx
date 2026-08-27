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
 *
 * `underlay`는 씬 배경 **위**, 본문 글자 **아래**에 들어가는 레이어다. 캐릭터가 여기로 가는
 * 이유는 `SceneRouter`의 주석에 적었다 — 한 줄로 요약하면, 겹쳤을 때 잃는 쪽이 캐릭터여야
 * 하기 때문이다.
 */
export function renderScene(
  scene: SceneDirective,
  palette: Palette,
  underlay?: React.ReactNode,
): React.ReactNode {
  const p = { palette, underlay };
  switch (scene.type) {
    case 'title_card': return <TitleCard scene={scene} {...p} />;
    case 'content_slide': return <ContentSlide scene={scene} {...p} />;
    case 'emphasis': return <KeywordEmphasis scene={scene} {...p} />;
    case 'list_reveal': return <ListReveal scene={scene} {...p} />;
    case 'quote': return <QuoteSlide scene={scene} {...p} />;
    case 'conclusion': return <ConclusionSlide scene={scene} {...p} />;
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
      {renderScene(
        withReelBackground(active, backgroundImageUrl),
        palette,
        /**
         * 캐릭터는 씬 **위**가 아니라 씬 배경과 본문 글자 **사이**로 들어간다.
         *
         * 본문 아래끝은 상한이 없다. `lib/pipeline/scenes.ts`가 목록 항목 **개수**는
         * MAX_ITEMS=5로 자르지만 **길이**는 자르지 않아서, 30자짜리 항목 다섯 개면
         * 본문이 y 1411까지 내려온다(실측). 자막 밴드(3줄 기준 y 1550)까지 139px밖에
         * 안 남는데, 그 정도로 줄인 캐릭터는 그릴 값어치가 없다. 즉 **어떤 고정 크기도
         * 안전하지 않다** — 크기만으로는 표본을 맞출 뿐이다.
         *
         * 그래서 겹침 자체를 막는 대신 **겹쳤을 때 지는 쪽을 캐릭터로 고정**한다.
         * 글자에 가려진 캐릭터는 그냥 덜 보이는 것이지만, 캐릭터에 가려진 글자는 릴을
         * 망친다. `Subtitles`가 zIndex 20으로 SceneRouter(10) 위에 앉아 자막을 지키는
         * 것과 같은 원리를 한 층 아래에 적용한 것이다.
         *
         * 단순히 `renderScene` **앞**에 그리면 안 된다. 씬 배경이 캐릭터를 덮기 때문이다 —
         * 배경 이미지가 있으면 완전히(실측 max delta 0), 그라디언트뿐이어도
         * `${palette.paper}f2`가 95% 불투명이라 사실상 안 보인다. 그래서 씬 컴포넌트가
         * 배경 바로 뒤에 `underlay` 슬롯을 열어 준다.
         *
         * 슬롯이 씬 루트 안이라 캐릭터는 씬의 opacity·scale·blur를 같이 받는다. 화면의
         * 나머지가 전부 그렇게 움직이므로 오히려 자연스럽고, scale이 캐릭터를 밀어내도
         * 위로 밀리면 글자에, 아래로 밀리면 자막에 가려질 뿐이라 안전한 방향이다.
         */
        active.characterImageUrl ? (
          <CharacterImage
            src={active.characterImageUrl}
            startTime={characterRunStart(scenes, scenes.indexOf(active))}
          />
        ) : undefined,
      )}
    </AbsoluteFill>
  );
};
