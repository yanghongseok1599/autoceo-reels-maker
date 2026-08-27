import React, { useState } from 'react';
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
} as const;

/**
 * 씬이 루트에 건 `scale(s)`를 상쇄하는 배율. 캐릭터 레이어가 씬 루트와 **같은 크기·같은
 * 변형 원점**(프레임 전체 AbsoluteFill의 가운데)이라 `1/s` 하나로 위치와 크기가 정확히
 * 되돌아온다 — 자식이 p → C + (p-C)/s, 부모가 그 결과 → C + (p-C) = p.
 */
export function undoSceneScale(sceneScale: number): number {
  return sceneScale > 0 ? 1 / sceneScale : 1;
}

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
 * 자막 뒤 가림막은 여기 없다. 캐릭터가 있든 없든 릴 전체에 같은 처리가 필요해서
 * `ReelVertical`이 `CaptionScrim`을 따로 얹는다.
 *
 * `src`는 public 루트 기준 상대 경로다. `resolveAudioSrc`는 이름과 달리 오디오 전용이 아니라
 * "원격 URL이면 그대로, 상대 경로면 `staticFile()`" 규칙이라 이미지에도 그대로 필요하다.
 * 이름만 오디오일 뿐 규칙은 미디어 일반이다 — 같은 규칙을 여기 다시 적으면 두 벌이 된다.
 *
 * **그림을 못 불러오면 캐릭터만 빠지고 릴스는 계속 간다.** Remotion의 `<Img>`는 두 번
 * 재시도한 뒤 `cancelRender('Error loading image with src: …')`를 부른다 — `onError`를 주지
 * 않으면 렌더가 통째로 중단된다. 실제로 그렇게 죽는 것을 확인했다
 * (`packages/video/src/__tests__/missingCharacterRender.test.ts`).
 *
 * 렌더 전 검사로는 이 구멍을 다 막지 못한다. 수강생 그림은 `publish`가 돌려준 Blob URL이라
 * **남의 서버에 있고**, 렌더 시점에 404가 날 수 있다. 복사 단계에서는 볼 수 없는 실패다.
 * 그래서 마지막 방어선은 여기다: 실패하면 이 레이어를 통째로 걷어 낸다. 언마운트되면
 * `<Img>`가 걸어 둔 `delayRender` 핸들도 정리 함수에서 `continueRender`로 풀리므로
 * 프레임이 멈추지도 않는다.
 *
 * **걷어 내는 것은 실패한 그림 하나지, 캐릭터라는 자리가 아니다.** 실패 표시를 `boolean`으로
 * 들고 있으면 안 된다 — `SceneRouter`는 씬이 바뀌어도 같은 자리에 이 컴포넌트를 그리므로
 * React가 인스턴스를 재사용하고, `src`가 바뀌어도 그 boolean은 살아남는다. 그러면 릴 앞쪽
 * 그림 한 장이 404난 순간부터 **뒤에 오는 멀쩡한 캐릭터가 전부 사라진다.** 실제로 그렇게
 * 되는 것을 두 씬 `renderFrames`로 확인했다(`missingCharacterRender.test.ts`의
 * "앞 씬에서 실패한 캐릭터가 뒤 씬의 캐릭터를 데려가지 않는다").
 *
 * 그래서 실패를 **그 `src`에 매어** 기억한다. 호출부에 `key={src}`를 다는 방법도 같은 결과를
 * 내지만, 그러면 이 컴포넌트가 약속한 "실패한 그림만 빠진다"가 **부르는 쪽이 key를 기억하는지**에
 * 걸린다 — 잊으면 아무 데서도 오류가 나지 않고 릴스에서 캐릭터만 조용히 사라진다. 그 보장은
 * 이 컴포넌트의 것이므로 여기서 지킨다.
 *
 * `startTime`은 형제 씬 컴포넌트와 같은 씬 프레임 계산을 하기 위해 받는다. 전역 프레임을
 * 그대로 쓰면 등장 모션이 릴 맨 앞에서 한 번만 재생되고, 3번째 씬에서 처음 나타나는
 * 캐릭터는 모션 없이 튀어나온다. 다만 이 값은 **씬의 시작이 아니라 이 캐릭터가 처음
 * 등장한 씬의 시작**이다 — `SceneRouter.characterRunStart` 주석 참고.
 */
export const CharacterImage: React.FC<{
  src: string;
  startTime: number;
  /** 이 캐릭터가 얹힌 씬이 루트에 건 scale 배율 */
  sceneScale: number;
}> = ({ src, startTime, sceneScale }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const sceneFrame = frame - Math.round(startTime * fps);
  const { opacity, translateY } = characterEntry(sceneFrame, fps);

  /**
   * 씬이 루트(프레임 전체 크기의 AbsoluteFill)에 건 `scale(s)`를 여기서 되돌린다.
   *
   * 이 AbsoluteFill도 프레임 전체 크기라 **변형 원점이 씬 루트와 같은 지점(가운데)** 이다.
   * 그래서 `scale(1/s)` 하나면 위치와 크기가 정확히 상쇄된다 — 따로 translate가 필요 없다.
   * (증명: 자식이 p → C + (p-C)/s, 부모가 그 결과 → C + (p-C) = p.)
   *
   * 이게 없으면 캐릭터가 씬의 등장 배율(0.7)에서 프레임 바닥에서 288px 떠오른다. 씬 글자에
   * 걸린 변형은 손대지 않고 이 슬롯만 면제하는 방법이다 — 그 변형은 여섯 컴포넌트가
   * 공유하며 이미 맞춰 놓은 값이다.
   */
  const counterScale = undoSceneScale(sceneScale);

  // 그림이 오지 않았다. 캐릭터 없는 씬은 멀쩡한 씬이다.
  if (failedSrc === src) return null;

  return (
    <AbsoluteFill
      style={{
        justifyContent: 'flex-end',
        alignItems: 'center',
        paddingBottom: BOX_BOTTOM,
        transform: `scale(${counterScale})`,
      }}
    >
      <Img
        src={resolveAudioSrc(src)}
        /**
         * 이 한 줄이 렌더가 죽는 것과 캐릭터만 빠지는 것을 가른다. `<Img>`는 `onError`가
         * **없을 때만** `cancelRender`를 부른다(`remotion/dist/cjs/Img.js`의 `didGetError`).
         * 재시도 두 번은 그대로 살려 둔다 — 잠깐 흔들린 CDN이라면 그 사이에 붙는다.
         */
        onError={() => setFailedSrc(src)}
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
