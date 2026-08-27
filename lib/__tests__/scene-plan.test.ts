import { describe, it, expect } from 'vitest';
import { planSceneTypes } from '../pipeline/scene-plan';
import { SCENE_TYPES } from '@studio/video/src/types';
import type { SubtitleJSON } from '@studio/video/src/types';

const seg = (id: number, text: string) => ({ id, text, start: id, end: id + 1, words: [] });
const subs = (...texts: string[]): SubtitleJSON => texts.map((t, i) => seg(i, t));

describe('planSceneTypes', () => {
  it('opens with a title card', () => {
    expect(planSceneTypes(subs('무릎 통증 잡는 법', '본문입니다'))[0]).toBe('title_card');
  });

  it('closes with a conclusion', () => {
    const plan = planSceneTypes(subs('제목', '본문', '마무리하겠습니다'));
    expect(plan[plan.length - 1]).toBe('conclusion');
  });

  it('gives a single segment only a title card', () => {
    expect(planSceneTypes(subs('한 문장뿐입니다'))).toEqual(['title_card']);
  });

  it('detects a list', () => {
    const plan = planSceneTypes(subs('제목', '첫째 준비, 둘째 하강, 셋째 상승', '끝'));
    expect(plan[1]).toBe('list_reveal');
  });

  it('detects a quote', () => {
    const plan = planSceneTypes(subs('제목', '코치가 "무릎은 발끝을 따라간다"고 했습니다', '끝'));
    expect(plan[1]).toBe('quote');
  });

  it('treats a very short line as emphasis', () => {
    const plan = planSceneTypes(subs('제목', '이게 핵심입니다', '끝'));
    expect(plan[1]).toBe('emphasis');
  });

  it('falls through to a content slide', () => {
    const plan = planSceneTypes(subs('제목', '발바닥을 바닥에 고르게 누르고 천천히 내려가세요', '끝'));
    expect(plan[1]).toBe('content_slide');
  });

  it('returns nothing for no segments', () => {
    expect(planSceneTypes([])).toEqual([]);
  });

  // --- 순서가 곧 명세다: 위치 규칙이 내용 규칙보다 항상 먼저다 ---

  it('gives a two-segment script a title card and a conclusion only', () => {
    // 세그먼트 1은 "첫 세그먼트가 아니면서 동시에 마지막"이다 — 규칙 2가 이긴다
    expect(planSceneTypes(subs('제목', '첫째 준비, 둘째 하강, 셋째 상승')))
      .toEqual(['title_card', 'conclusion']);
  });

  it('keeps the first segment a title card even when its text looks like a list', () => {
    const plan = planSceneTypes(subs('첫째 준비, 둘째 하강, 셋째 상승', '본문', '끝'));
    expect(plan[0]).toBe('title_card');
  });

  it('keeps the last segment a conclusion even when its text looks like a quote', () => {
    const plan = planSceneTypes(subs('제목', '본문', '코치가 "끝"이라고 했습니다'));
    expect(plan[2]).toBe('conclusion');
  });

  // --- 내용 규칙끼리도 순서가 명세다 ---

  it('prefers a list over a quote when the text carries both signals', () => {
    const plan = planSceneTypes(subs('제목', '코치가 "첫째, 둘째, 셋째"라고 했습니다', '끝'));
    expect(plan[1]).toBe('list_reveal');
  });

  it('prefers a quote over emphasis for a short quoted line', () => {
    const plan = planSceneTypes(subs('제목', '"무릎이 먼저"', '끝'));
    expect(plan[1]).toBe('quote');
  });

  it('detects a list from commas alone', () => {
    const plan = planSceneTypes(subs('제목', '어깨를 펴고, 무릎을 세우고, 천천히 내려갑니다', '끝'));
    expect(plan[1]).toBe('list_reveal');
  });

  it('detects a numbered list', () => {
    const plan = planSceneTypes(subs('제목', '1. 준비 자세를 잡고 그대로 유지합니다', '끝'));
    expect(plan[1]).toBe('list_reveal');
  });

  // --- 빈 입력에도 반드시 씬 타입 하나를 돌려준다 (Task 4가 undefined를 만나면 안 된다) ---

  it('still assigns a type to a blank middle segment', () => {
    const plan = planSceneTypes(subs('제목', '   ', '끝'));
    expect(plan[1]).toBe('emphasis');
  });

  it('returns exactly one type per segment, always a known scene type', () => {
    const plan = planSceneTypes(subs('제목', '본문입니다', '', '첫째, 둘째, 셋째', '끝'));
    expect(plan).toHaveLength(5);
    for (const type of plan) {
      expect(SCENE_TYPES).toContain(type);
    }
  });
});

/**
 * 규칙 자체가 오분류를 내던 두 경우. 한국어에는 어간이 `라고`로 끝나는 평범한 동사가 많고
 * (자라고·바라고·모르라고), 숫자 뒤의 마침표는 목록 번호가 아니라 소수점일 수 있다.
 */
describe('planSceneTypes — 오탐 방지', () => {
  const mid = (text: string) =>
    planSceneTypes(subs('제목', text, '끝'))[1];

  it('does not call an ordinary 라고-stem verb a quote', () => {
    // 자라다 → 자라고. 인용이 아니라 그냥 근육이 자라고 있다는 문장이다
    expect(mid('근육이 무럭무럭 자라고 있는 상태를 유지해야 합니다')).not.toBe('quote');
  });

  it('does not call 바라고 a quote either', () => {
    expect(mid('그 자세를 계속 바라고만 있으면 절대 바뀌지 않습니다')).not.toBe('quote');
  });

  it('detects a quote from 라고 followed by a speech verb', () => {
    expect(mid('코치가 무릎은 발끝을 따라간다라고 했습니다')).toBe('quote');
  });

  it('still detects a quote from quotation marks alone', () => {
    expect(mid('코치가 "무릎은 발끝을 따라간다"고 했습니다')).toBe('quote');
  });

  it('detects a numbered list with no space after the marker', () => {
    expect(mid('1.준비, 2.하강, 3.상승')).toBe('list_reveal');
  });

  it('detects a spaceless numbered list even without commas', () => {
    // 쉼표 규칙이 대신 걸리지 않도록 쉼표를 뺐다 — 오직 번호 표시만으로 판정되어야 한다
    expect(mid('1.준비 2.하강 3.상승 순서로 천천히 반복하세요')).toBe('list_reveal');
  });

  it('does not mistake a decimal number for a list marker', () => {
    expect(mid('무게는 3.5킬로그램으로 시작하세요')).not.toBe('list_reveal');
  });

  it('does not mistake a decimal duration for a list marker', () => {
    expect(mid('내려갈 때는 1.5초를 유지하면서 호흡을 뱉으세요')).not.toBe('list_reveal');
  });
});
