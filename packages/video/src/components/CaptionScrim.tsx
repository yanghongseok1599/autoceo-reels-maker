import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { Palette } from '../types';

/**
 * 자막 뒤에 까는 그라디언트 가림막의 높이. 프레임 바닥에 붙으므로 1080x1920에서
 * y 1400~1920이다.
 *
 * 520은 세 줄 자막(y 1550~1760)을 덮고도 위로 150px 남는 값이다 — 그 여유가 있어야 윗변이
 * "막대"가 아니라 서서히 어두워지는 것으로 읽힌다. 자막 첫 줄에 닿을 때(y 1550, 스크림의
 * 29% 지점) 비로소 0.4 언저리가 되고, 그보다 위는 거의 투명하다.
 */
export const SCRIM_HEIGHT = 520;

/**
 * 자막 글자와 바로 옆 배경의 WCAG 명도 대비 **실측값**. 스크림을 걷어내면 무엇이 사라지는지
 * 코드에 남겨 둔다. 전부 1080x1920 실제 렌더에서 자막 밴드(y 1550~1780)만 떼어 잰 값이고,
 * 글자 마스크는 캐릭터도 스크림도 없는 참조 프레임에서 만들었다.
 */
export const SCRIM_MEASURED = {
  /** 배경 이미지도 캐릭터도 없는 씬 — 원래 자막이 얼마나 또렷했는지의 기준선 */
  cleanBackdrop: 17.31,

  /**
   * 최악: 배경 이미지 + 캐릭터. 스크림이 없으면 큰 글자 기준(3:1)**마저** 못 넘는다.
   * 스크림이 선택이 아니라는 근거다.
   */
  worstWithoutScrim: 2.86,
  worstWithScrim: 10.13,

  /**
   * 캐릭터 **없이** 배경 이미지만 있는 씬. 스크림을 캐릭터 유무와 무관하게 릴 전체에 까는
   * 두 번째 근거다 — `pickBackground`가 모든 씬에 사진을 깔기 때문에 이 경우가 기본값이다.
   * "캐릭터용이니 떼자"는 판단을 막으려고 따로 적어 둔다.
   */
  backgroundOnlyWithoutScrim: 4.90,
  backgroundOnlyWithScrim: 12.12,

  /** WCAG AA 큰 글자(18.66px 이상 굵은 글씨) 기준. 자막은 46px/800이라 여기에 해당한다 */
  wcagAaLargeText: 3,
  /** WCAG AA 본문 글자 기준. 큰 글자인 자막에 이걸 목표로 삼아 여유를 둔다 */
  wcagAaNormalText: 4.5,
} as const;

/**
 * 자막 가독성을 **뒤에 뭐가 있든 상관없게** 떼어 놓는 층. 숏폼의 표준 처리다.
 *
 * ## 왜 릴 전체에 무조건 그리는가
 * 처음에는 캐릭터가 있을 때만 `CharacterImage` 안에서 그렸다. 그런데 Task 5의 캐릭터 배정은
 * 세그먼트 텍스트 키워드 매칭이라 대부분의 평범한 줄(`발바닥을 누르세요` 같은)은 아무것도
 * 고르지 못한다 — 여섯 씬 중 두세 씬에만 캐릭터가 붙는 게 보통이다. 조건부로 두면 자막
 * 뒤 어둠이 씬마다 들락거린다. **자막 밴드의 성격이 영상 중간에 바뀌면 안 된다.**
 *
 * 캐릭터가 없을 때도 값을 한다. `pickBackground`가 모든 씬에 배경 이미지를 깔기 때문에,
 * 캐릭터 위에서 스크림을 정당화한 것과 **같은 대비 논리가 사진 위에서도 그대로** 적용된다
 * (실측값은 `CharacterImage.MEASURED` 참고). 그러니 "캐릭터용"이라며 걷어내면 안 된다.
 *
 * ## 어느 층인가
 * `ReelVertical`에서 씬(zIndex 10)과 자막(zIndex 20) 사이에 앉는다. 씬 배경·캐릭터·본문
 * 글자 위, 자막 아래다. 씬 안이 아니라 릴 레벨에 두는 이유는 씬의 등장·퇴장 페이드를 받지
 * 않기 위해서다 — 씬 안에 두면 씬이 바뀔 때마다 자막 뒤 어둠이 같이 출렁인다.
 *
 * 본문 글자보다 위라 아주 긴 본문이 이 구간까지 내려오면 살짝 어두워진다. 실측한 가장 긴
 * 본문의 아래끝은 y 1411인데 거기서 스크림 불투명도는 0.02라 사실상 영향이 없고, 그보다
 * 더 내려간 글자는 이미 자막 밴드와 겹친 상태다.
 */
export const CaptionScrim: React.FC<{ palette: Palette }> = ({ palette }) => (
  <AbsoluteFill
    style={{
      top: undefined,
      height: SCRIM_HEIGHT,
      bottom: 0,
      background: `linear-gradient(180deg, transparent 0%, ${palette.paper}40 22%, ${palette.paper}b3 46%, ${palette.paper}e0 72%, ${palette.paper}eb 100%)`,
    }}
  />
);
