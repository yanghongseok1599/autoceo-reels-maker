import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { resolveAudioSrc } from '../utils/audioSrc';

/**
 * 캐릭터가 들어갈 상자. **가로만 정하면 안 된다.**
 *
 * 브리프는 `width: 620`만 주고 높이를 원본 비율에 맡겼다. 클립아트 라이브러리 104장을
 * 실제로 재 보면 78장이 세로가 아니다 — 정사각 1254x1254가 63장, 가로(1448x1086 등)가
 * 15장이다. 가로만 고정하면 같은 620px에서 렌더 높이가 465px~826px로 흔들린다 —
 * 아래 안전 구간을 지킬 수가 없다.
 *
 * 그래서 가로·세로를 다 정한 상자에 `objectFit: 'contain'`으로 넣는다. contain은 두 축을
 * 모두 넘지 않으므로 어떤 비율이 와도 상자 밖으로 나가지 않는다. 라이브러리에서 가장
 * 납작한 비율(1448/1086 ≈ 1.33)도 높이 290에서 387px이라 가로 520 안에 들어간다 —
 * 실질적으로 높이가 크기를 정하고, 가로는 안전망이다.
 */
export const BOX_WIDTH = 360;
export const BOX_HEIGHT = 200;

/**
 * 화면 아래에서 상자 바닥까지의 거리. 1080x1920에서 상자는 y 1300~1500을 차지한다.
 *
 * ## 아래 경계 — 자막 (단단한 값)
 * `Subtitles.tsx`의 paddingBottom 160, 46px x 1.35 줄높이, gap 12에서 밴드 윗끝이 나온다.
 * 실측: 한 줄 y≥1707, 두 줄 y≥1633, 세 줄 y≥1559(라인박스 상단 1549.7). 세 줄을 기준으로
 * 잡아 상자 바닥을 1500에 두면 50px 남는다. 여유를 30이 아니라 50으로 잡은 이유는 아래
 * "씬 변형" 항목 때문이다. (네 줄이면 1475.6까지 올라오는데, 한 세그먼트가
 * 70자를 넘어야 해서 한국어 whisper 세그먼트로는 드물다.)
 *
 * ## 위 경계 — 본문 (표본일 수밖에 없는 값)
 * 본문 아래끝에는 **상한이 없다**. `lib/pipeline/scenes.ts`가 목록 항목 개수는 MAX_ITEMS=5로
 * 자르지만 길이는 자르지 않는다. 실측한 아래끝:
 *
 *   content_slide 5불릿                       1164
 *   list_reveal 짧은 항목 5개 + 40자 제목      1209   ← 항목이 전부 한 줄인 최대치
 *   list_reveal 22자 항목 5개                  1300   (리뷰어 실측)
 *   list_reveal 30자 항목 5개 + 40자 제목      1411   ← 파이프라인이 허용하는 최대치
 *
 * 최대치(1411)를 피하려면 상자가 100px대로 내려가는데, 그 크기의 캐릭터는 그릴 값어치가
 * 없다. 즉 **어떤 고정 크기도 안전하지 않다.** 그래서 크기는 "항목이 한 줄로 읽히는
 * 목록"까지(1300)를 기준으로 잡고, 그 너머는 겹치게 두되 **캐릭터가 가려지도록** 층을
 * 정한다 — `SceneRouter`가 캐릭터를 본문 글자 아래(`underlay`)에 넣는 이유다.
 *
 * ## 씬 변형 — 캐릭터가 씬의 scale을 같이 받는다
 * `underlay` 슬롯이 씬 루트 안이라 `getEntryExitScale`의 배율이 캐릭터에도 걸린다. 배율이
 * 가장 큰 `emphasis`(1 → 1.12)에서 상자 바닥은 960 + (1500-960) x 1.12 = 1565까지 내려간다 —
 * 세 줄 자막 밴드를 15px 파고든다. 안전한 방향이다: 자막은 zIndex 20으로 씬 위에 있어서
 * 글자가 이기고 캐릭터만 가려진다. 위쪽으로 밀릴 때(등장 배율 0.7)도 본문 글자가 이긴다.
 *
 * 이 숫자를 무효로 만드는 것: `Subtitles`의 폰트·줄높이·paddingBottom 변경, 씬 컴포넌트의
 * 세로 배치나 `getEntryExitScale` 범위 변경, `MAX_ITEMS`/`MAX_TITLE` 변경.
 */
export const BOX_BOTTOM = 420;

/**
 * 등장할 때 아래에서 올라오는 거리. 48px이 아니라 28px인 이유가 있다 — 제자리(바닥 y 1500)는
 * 세 줄 자막 밴드(y 1550)에서 50px 위다. 더 크게 잡으면 반쯤 보이는 상태로 자막에 닿는다.
 */
export const ENTRY_RISE = 28;

/**
 * 위 상수들을 고른 근거가 된 **실측값**. 테스트가 크기와 근거를 함께 붙들도록 내보낸다 —
 * 이 값이 바뀌면 상자 크기도 다시 계산해야 한다.
 */
export const MEASURED = {
  /** 세 줄 자막 라인박스 상단 (1920 - 160 - (46*1.35*3 + 12*2)) */
  subtitleTop3Line: 1549.7,
  /** 항목이 한 줄로 읽히는 목록의 본문 아래끝 (리뷰어 실측) */
  bodyFloorReadableList: 1300,
  /** 파이프라인이 허용하는 최대 본문 아래끝 — 어떤 고정 크기로도 못 피한다 */
  bodyFloorPipelineMax: 1411,
  frameHeight: 1920,
} as const;

/** 1080x1920 프레임에서 상자가 차지하는 세로 구간 */
export function characterBoxBounds(): { top: number; bottom: number } {
  const bottom = MEASURED.frameHeight - BOX_BOTTOM;
  return { top: bottom - BOX_HEIGHT, bottom };
}

/** 프레임 0에서 아래에 투명하게 있다가 0.5초에 걸쳐 제자리로 올라온다. */
export function characterEntry(sceneFrame: number, fps: number) {
  const settle = Math.max(1, Math.round(fps * 0.5));
  const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  return {
    opacity: interpolate(sceneFrame, [0, settle], [0, 1], opts),
    translateY: interpolate(sceneFrame, [0, settle], [ENTRY_RISE, 0], opts),
  };
}

/**
 * 씬 배경과 본문 글자 **사이**에 들어가는 캐릭터. 자리는 본문 아래·자막 위지만, 본문이
 * 길어져 내려오면 글자가 캐릭터를 덮는다 — 그 층 선택의 이유는 `SceneRouter`에 적었다.
 *
 * `src`는 public 루트 기준 상대 경로다. `resolveAudioSrc`는 이름과 달리 오디오 전용이 아니라
 * "원격 URL이면 그대로, 상대 경로면 `staticFile()`" 규칙이라 이미지에도 그대로 필요하다.
 * 이름만 오디오일 뿐 규칙은 미디어 일반이다 — 같은 규칙을 여기 다시 적으면 두 벌이 된다.
 *
 * `startTime`은 형제 씬 컴포넌트와 같은 씬 프레임 계산을 하기 위해 받는다. 전역 프레임을
 * 그대로 쓰면 등장 모션이 릴 맨 앞에서 한 번만 재생되고, 3번째 씬에서 처음 나타나는
 * 캐릭터는 모션 없이 튀어나온다. 다만 이 값은 **씬의 시작이 아니라 이 캐릭터가 처음
 * 등장한 씬의 시작**이다 — `SceneRouter.characterRunStart` 주석 참고.
 */
export const CharacterImage: React.FC<{ src: string; startTime: number }> = ({ src, startTime }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrame = frame - Math.round(startTime * fps);
  const { opacity, translateY } = characterEntry(sceneFrame, fps);

  return (
    <AbsoluteFill
      style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: BOX_BOTTOM }}
    >
      <Img
        src={resolveAudioSrc(src)}
        style={{
          width: BOX_WIDTH,
          height: BOX_HEIGHT,
          objectFit: 'contain',
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      />
    </AbsoluteFill>
  );
};
