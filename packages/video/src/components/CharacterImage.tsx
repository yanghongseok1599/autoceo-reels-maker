import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { resolveAudioSrc } from '../utils/audioSrc';

/**
 * 캐릭터가 들어갈 상자. **가로만 정하면 안 된다.**
 *
 * 브리프는 `width: 620`만 주고 높이를 원본 비율에 맡겼다. 클립아트 라이브러리를 실제로 재
 * 보면 104장 중 62장이 정사각(1254x1254)이고, 세로(1086x1448)와 **가로**(1448x1086)가
 * 섞여 있다. 가로만 고정하면 같은 620px에서 렌더 높이가 465px~826px로 흔들린다 —
 * 아래 안전 구간을 지킬 수가 없다.
 *
 * 그래서 가로·세로를 다 정한 상자에 `objectFit: 'contain'`으로 넣는다. contain은 두 축을
 * 모두 넘지 않으므로 어떤 비율이 와도 상자 밖으로 나가지 않는다. 라이브러리에서 가장
 * 납작한 비율(1448/1086 ≈ 1.33)도 높이 290에서 387px이라 가로 520 안에 들어간다 —
 * 실질적으로 높이가 크기를 정하고, 가로는 안전망이다.
 */
const BOX_WIDTH = 520;
const BOX_HEIGHT = 290;

/**
 * 화면 아래에서 상자 바닥까지의 거리. 1080x1920에서 상자는 y 1230~1520을 차지한다.
 *
 * 이 두 숫자는 취향이 아니라 **실측**이다. 같은 브랜치에서 렌더한 프레임을 픽셀로 재면:
 *   - 본문이 가장 긴 씬은 `list_reveal` 5항목으로 y 703~1209 (`content_slide` 5불릿은 1164)
 *   - 자막 밴드는 줄 수에 따라 위로 자란다. 한 줄 y≥1707, 두 줄 y≥1633, 세 줄 y≥1559
 *     (`Subtitles.tsx`의 paddingBottom 160, 46px x 1.35 줄높이, gap 12에서 나오는 값이고
 *      세 줄 라인박스 상단은 1549.7)
 * 남는 구간은 1209~1550, 341px뿐이다. 상자를 290으로 잡으면 위로 21px, 아래로 30px 여유가
 * 남는다.
 *
 * 브리프의 `width: 620` + `paddingBottom: 300`은 세로 1150x1370 기준 y 882~1620이라
 * 위로는 본문 글자를 덮고 아래로는 자막을 파고든다. 캐릭터보다 글자가 우선이므로
 * (글을 가리는 캐릭터는 릴스를 망친다) 상자를 남는 구간에 맞춰 줄였다.
 */
const BOX_BOTTOM = 400;

/**
 * 등장할 때 아래에서 올라오는 거리. 48px이 아니라 28px인 이유가 있다 — 제자리(바닥 y 1520)는
 * 세 줄 자막 밴드(y 1550)에서 30px 위다. 더 크게 잡으면 반쯤 보이는 상태로 자막을 덮는다.
 */
const ENTRY_RISE = 28;

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
 * 씬 위에 얹는 캐릭터. 본문과 자막 **사이**에 앉으므로 어느 쪽도 가리지 않는다.
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
