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
export const BOX_WIDTH = 620;
export const BOX_HEIGHT = 620;

/**
 * 화면 아래에서 상자 바닥까지의 거리. 0 — 상자는 프레임 바닥에 붙는다.
 * 1080x1920에서 상자는 y 1300~1920을 차지한다.
 *
 * ## 왜 바닥까지 내려도 되는가
 * 처음에는 상자를 본문과 자막 **사이**(y 1300~1500, 높이 200)에 가뒀다. 그건 캐릭터가
 * 겹쳤을 때 **이기던** 시절의 제약이다. 지금은 `SceneRouter`가 캐릭터를 본문 글자 아래
 * (`underlay`)에 넣고 자막은 zIndex 20으로 그 위에 있어서, **겹치면 언제나 캐릭터가 진다.**
 * 그러면 캐릭터를 자막 밴드 안으로 내려도 글자는 잃을 게 없다 — 실측으로 확인했다
 * (아래 "글자 손실" 참고). 그래서 위끝만 지키고 아래는 프레임 끝까지 쓴다.
 *
 * ## 위끝 1300 — 여기는 여전히 지킨다
 * 캐릭터가 본문을 **가리지는** 않지만, 본문 뒤로 파고들면 보기 사납다. 항목이 한 줄로
 * 읽히는 목록의 본문 아래끝(실측 1300)을 위끝으로 잡아 흔한 내용에서는 겹치지 않게 둔다.
 * 그보다 긴 본문은 겹치되 글자가 위에 그려진다.
 *
 * ## 씬 변형 — 캐릭터가 씬의 scale을 같이 받는다
 * `underlay` 슬롯이 씬 루트 안이라 `getEntryExitScale`의 배율이 캐릭터에도 걸린다.
 * 배율이 최대인 `emphasis`(→1.12)에서 상자 바닥은 프레임 밖(y 2035)까지 내려가 발끝이
 * 잘리고, 등장 배율(0.7)에서는 바닥이 y 1632로 올라와 프레임 바닥에서 잠깐 떨어진다.
 * 둘 다 씬 전체가 같이 커지고 작아지는 구간이라 따로 튀지 않는다.
 *
 * 이 숫자를 무효로 만드는 것: `SceneRouter`가 캐릭터를 다시 본문 **위**로 올리는 것(그러면
 * 상자를 y 1300~1500으로 되돌려야 한다), 씬 컴포넌트의 세로 배치 변경, `MAX_TITLE` 변경.
 */
export const BOX_BOTTOM = 0;

/**
 * 등장할 때 아래에서 올라오는 거리. 상자가 프레임 바닥에 붙었으므로 이 이동은 캐릭터를
 * 프레임 밖으로 내렸다가 올려 놓는다 — 자막을 덮을 걱정은 없다(자막이 위에 그려진다).
 */
export const ENTRY_RISE = 28;

/**
 * 위 상수들을 고른 근거가 된 **실측값**. 테스트가 크기와 근거를 함께 붙들도록 내보낸다 —
 * 이 값이 바뀌면 상자 크기도 다시 계산해야 한다.
 */
export const MEASURED = {
  /** 세 줄 자막 라인박스 상단 (1920 - 160 - (46*1.35*3 + 12*2)) */
  subtitleTop3Line: 1549.7,
  /** 항목이 한 줄로 읽히는 목록의 본문 아래끝 (실측) */
  bodyFloorReadableList: 1300,
  /**
   * 40자 제목 + 30자 항목 5개에서 실측한 본문 아래끝. **상한이 아니다.**
   * `lib/pipeline/scenes.ts`의 `splitItems`는 항목 **개수**만 5로 자르고 **길이**는 자르지
   * 않으므로 본문 아래끝에는 천장이 없다. 이 값은 "여기까지는 실제로 봤다"는 표본일 뿐이다.
   */
  bodyFloorLongItemsSample: 1411,
  frameHeight: 1920,
  /**
   * 캐릭터 위에 얹힌 자막의 실측 명도 대비(WCAG). 캐릭터가 없으면 17.3:1이고, 뒤에 캐릭터가
   * 깔리면 클립아트에 따라 3.27:1(가장 나쁜 경우, 본문 최악 케이스 + 세로 클립아트)
   * ~5.45:1로 떨어진다. `Subtitles`의 textShadow가 만드는 어두운 헤일로가 이 차이를 메운다 —
   * 프레임을 원본 해상도로 잘라 직접 읽어 확인했다. 다만 여유가 얇다.
   */
  captionContrastOverCharacter: 3.27,
  /** WCAG AA 큰 글자(18.66px 이상 굵은 글씨) 기준. 자막은 46px/800이라 여기에 해당한다 */
  wcagAaLargeText: 3,
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
          // contain이 남기는 여백을 가운데가 아니라 아래로 몰아, 어떤 비율이든 프레임
          // 바닥에 서게 한다. 라이브러리 104장 중 78장이 세로가 아니라 이게 꼭 필요하다.
          objectPosition: 'bottom',
          opacity,
          transform: `translateY(${translateY}px)`,
        }}
      />
    </AbsoluteFill>
  );
};
