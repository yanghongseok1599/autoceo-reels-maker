import { describe, it, expect } from 'vitest';
import {
  buildHiggsfieldAvatarPrompt,
  buildHiggsfieldExercisePrompt,
  higgsfieldAvatarChecklist,
  higgsfieldExerciseChecklist,
  type HiggsfieldAvatarPromptInput,
  type HiggsfieldExercisePromptInput,
} from '../higgsfield-workflow';

/**
 * 이 두 함수의 결과는 수강생이 힉스필드에 **그대로 붙여 넣는 값**이다. 입력 칸 하나가
 * 프롬프트에 닿지 않으면 화면에는 다 채워진 것처럼 보이는데 결과 영상만 엉뚱하게 나오고,
 * 수강생은 자기가 뭘 잘못 넣었는지 알 방법이 없다.
 *
 * 그래서 **문장이 아니라 "입력이 출력에 닿는가"를** 본다. 프롬프트 전문을 통째로 박으면
 * 문구를 한 글자 다듬을 때마다 빨개져서, 결국 검사를 지우게 된다.
 */

const avatar = (over: Partial<HiggsfieldAvatarPromptInput> = {}): HiggsfieldAvatarPromptInput => ({
  script: '오늘은 스쿼트 자세를 알려드릴게요.',
  avatarFileName: 'trainer-face.jpg',
  voiceFileName: 'trainer-voice.mp3',
  duration: '12초',
  quality: '1080p',
  toneLabel: '차분하고 친근하게',
  usesRecordedNarration: false,
  ...over,
});

const exercise = (over: Partial<HiggsfieldExercisePromptInput> = {}): HiggsfieldExercisePromptInput => ({
  exercisePrompt: '무릎을 90도까지 굽히는 바디웨이트 스쿼트',
  poseGuideName: 'squat-pose.png',
  referenceNames: ['trainer-a.png', 'trainer-b.png'],
  duration: '8초',
  quality: '1080p',
  ...over,
});

describe('buildHiggsfieldAvatarPrompt — 입력이 프롬프트에 닿는다', () => {
  it('대본이 프롬프트 안에 들어간다', () => {
    expect(buildHiggsfieldAvatarPrompt(avatar())).toContain('오늘은 스쿼트 자세를 알려드릴게요.');
  });

  /** 붙여 넣기로 들어온 대본은 앞뒤 공백이 흔하다. 그대로 실으면 프롬프트 줄이 어긋난다. */
  it('대본의 앞뒤 공백을 떼고 싣는다', () => {
    const out = buildHiggsfieldAvatarPrompt(avatar({ script: '  \n안녕하세요\n  ' }));
    expect(out).toContain('Script: 안녕하세요');
    expect(out).not.toContain('Script:   ');
    expect(out.endsWith(' ')).toBe(false);
  });

  it('얼굴 사진 파일명이 아바타 레퍼런스로 들어간다', () => {
    expect(buildHiggsfieldAvatarPrompt(avatar())).toContain('trainer-face.jpg');
  });

  /** 파일명을 아직 모를 때도 문장이 비지 않아야 한다 — 빈 레퍼런스는 힉스필드가 무시한다. */
  it('얼굴 사진 파일명이 없으면 한국어 자리표시자를 쓴다', () => {
    const out = buildHiggsfieldAvatarPrompt(avatar({ avatarFileName: undefined }));
    expect(out).toContain('얼굴 사진');
    expect(out).not.toContain('Avatar reference: .');
  });

  it('빈 문자열 파일명도 없는 것으로 본다', () => {
    expect(buildHiggsfieldAvatarPrompt(avatar({ avatarFileName: '' }))).toContain('얼굴 사진');
  });

  it('톤·길이·화질이 모두 프롬프트에 실린다', () => {
    const out = buildHiggsfieldAvatarPrompt(avatar());
    expect(out).toContain('차분하고 친근하게');
    expect(out).toContain('12초');
    expect(out).toContain('1080p');
  });

  it('길이와 화질은 서로 다른 자리에 실린다', () => {
    const out = buildHiggsfieldAvatarPrompt(avatar({ duration: '7초', quality: '4K' }));
    expect(out).toMatch(/Target duration: 7초/);
    expect(out).toMatch(/Output quality: 4K/);
  });

  it('여러 줄로 이어 붙인다 — 한 줄로 뭉치지 않는다', () => {
    expect(buildHiggsfieldAvatarPrompt(avatar()).split('\n').length).toBeGreaterThan(5);
  });

  /**
   * 릴스에 자막은 앱이 얹는다. 힉스필드가 화면에 글자를 태워 버리면 그 위에 또 자막이
   * 겹쳐서 못 쓰는 영상이 된다 — 두 프롬프트 모두에서 이걸 금지하는 이유다.
   */
  it('화면 글자를 금지하는 네거티브가 붙는다', () => {
    const out = buildHiggsfieldAvatarPrompt(avatar());
    expect(out).toContain('Negative:');
    expect(out).toContain('no text overlay');
    expect(out).toContain('no subtitles');
  });
});

/**
 * 녹음을 올린 수강생과 목소리를 합성한 수강생은 **같은 지시를 받으면 안 된다.**
 * 녹음본은 "그대로 쓰라"는 뜻이고, 합성본은 "이 목소리를 참고하라"는 뜻이다.
 * 둘이 섞이면 자기 녹음을 올렸는데 다른 목소리가 나오는 영상이 만들어진다.
 */
describe('buildHiggsfieldAvatarPrompt — 녹음본과 합성본을 갈라 말한다', () => {
  it('녹음 나레이션이면 그 파일을 그대로 쓰라고 지시한다', () => {
    const out = buildHiggsfieldAvatarPrompt(avatar({ usesRecordedNarration: true }));
    expect(out).toContain('trainer-voice.mp3');
    expect(out).toContain('exact voice track');
  });

  it('합성 음성이면 목소리 레퍼런스로 쓰라고 지시한다', () => {
    const out = buildHiggsfieldAvatarPrompt(avatar({ usesRecordedNarration: false }));
    expect(out).toContain('trainer-voice.mp3');
    expect(out).toContain('voice reference');
  });

  it('두 갈래의 지시 문장은 서로 다르다', () => {
    const recorded = buildHiggsfieldAvatarPrompt(avatar({ usesRecordedNarration: true }));
    const synthesized = buildHiggsfieldAvatarPrompt(avatar({ usesRecordedNarration: false }));
    expect(recorded).not.toBe(synthesized);
    expect(recorded).not.toContain('voice reference');
    expect(synthesized).not.toContain('exact voice track');
  });

  it('음성 파일명이 없을 때의 자리표시자도 갈래마다 다르다', () => {
    const recorded = buildHiggsfieldAvatarPrompt(
      avatar({ usesRecordedNarration: true, voiceFileName: undefined }),
    );
    const synthesized = buildHiggsfieldAvatarPrompt(
      avatar({ usesRecordedNarration: false, voiceFileName: undefined }),
    );
    expect(recorded).toContain('전체 녹음 파일');
    expect(synthesized).toContain('목소리 파일');
    expect(recorded).not.toContain('전체 녹음 파일.mp3');
  });
});

describe('buildHiggsfieldExercisePrompt — 입력이 프롬프트에 닿는다', () => {
  it('운동 설명이 프롬프트 맨 앞에 온다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise());
    expect(out).toContain('무릎을 90도까지 굽히는 바디웨이트 스쿼트');
    expect(out.split('\n')[0]).toBe('무릎을 90도까지 굽히는 바디웨이트 스쿼트');
  });

  it('운동 설명의 앞뒤 공백을 뗀다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise({ exercisePrompt: '  런지  ' }));
    expect(out.split('\n')[0]).toBe('런지');
  });

  it('레퍼런스 이미지 이름을 모두 싣는다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise());
    expect(out).toContain('trainer-a.png');
    expect(out).toContain('trainer-b.png');
  });

  /** 하나만 실리고 나머지가 조용히 떨어지면, 수강생은 왜 다른 트레이너가 나오는지 모른다. */
  it('레퍼런스가 여러 장이면 한 줄에 모아 나열한다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise({
      referenceNames: ['a.png', 'b.png', 'c.png'],
    }));
    expect(out).toContain('a.png, b.png, c.png');
  });

  it('레퍼런스가 하나도 없으면 한국어 자리표시자를 쓴다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise({ referenceNames: [] }));
    expect(out).toContain('트레이너 레퍼런스 이미지');
  });

  it('포즈 가이드 이름이 실리고, 없으면 자리표시자를 쓴다', () => {
    expect(buildHiggsfieldExercisePrompt(exercise())).toContain('squat-pose.png');
    expect(buildHiggsfieldExercisePrompt(exercise({ poseGuideName: undefined })))
      .toContain('동작 가이드 이미지');
    expect(buildHiggsfieldExercisePrompt(exercise({ poseGuideName: '' })))
      .toContain('동작 가이드 이미지');
  });

  it('포즈 가이드와 레퍼런스가 같은 줄에 함께 나간다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise());
    const line = out.split('\n').find((l) => l.startsWith('Reference assets:'));
    expect(line).toBeDefined();
    expect(line).toContain('squat-pose.png');
    expect(line).toContain('trainer-a.png');
  });

  it('길이와 화질이 프롬프트에 실린다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise({ duration: '15초', quality: '4K' }));
    expect(out).toContain('15초');
    expect(out).toContain('4K');
  });

  /** 자세 교정 영상이므로 몸 전체가 보여야 하고 동작이 해부학적으로 맞아야 한다. */
  it('세로 9:16과 자세 확인 가능한 프레이밍을 요구한다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise());
    expect(out).toContain('9:16');
    expect(out.toLowerCase()).toContain('full body');
    expect(out.toLowerCase()).toContain('anatomically correct');
  });

  it('화면 글자를 금지하는 네거티브가 붙는다', () => {
    const out = buildHiggsfieldExercisePrompt(exercise());
    expect(out).toContain('Negative:');
    expect(out).toContain('no text overlay');
  });

  it('여러 줄로 이어 붙인다', () => {
    expect(buildHiggsfieldExercisePrompt(exercise()).split('\n').length).toBeGreaterThan(4);
  });
});

/**
 * 체크리스트는 `app/page.tsx`가 화면에 그대로 뿌린다. 빈 배열이 되면 화면에서 그 자리가
 * **사라질 뿐 오류가 나지 않아서**, 아무도 눈치채지 못한 채 수강생만 안내를 잃는다.
 *
 * 문구 자체는 박지 않는다(고칠 때마다 빨개지면 검사를 지우게 된다). 대신 **개수·빈 항목
 * 없음·의미의 앵커** — 이 세 가지를 본다.
 */
describe('힉스필드 체크리스트', () => {
  const checklists: [string, readonly string[]][] = [
    ['운동', higgsfieldExerciseChecklist],
    ['아바타', higgsfieldAvatarChecklist],
  ];

  it.each(checklists)('%s 체크리스트는 비어 있지 않다', (_name, list) => {
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(4);
  });

  it.each(checklists)('%s 체크리스트에 빈 항목이 없다', (_name, list) => {
    for (const item of list) {
      expect(typeof item).toBe('string');
      expect(item.trim().length).toBeGreaterThan(0);
    }
  });

  it.each(checklists)('%s 체크리스트에 중복된 항목이 없다', (_name, list) => {
    expect(new Set(list).size).toBe(list.length);
  });

  /** 세로 릴스라는 것과, 결과물을 다시 올려 학습시킨다는 것 — 이 둘이 두 흐름의 뼈대다. */
  it.each(checklists)('%s 체크리스트는 9:16과 재업로드 학습을 안내한다', (_name, list) => {
    expect(list.some((item) => item.includes('9:16'))).toBe(true);
    expect(list.some((item) => item.includes('업로드'))).toBe(true);
  });

  it('두 체크리스트는 서로 다른 안내다', () => {
    expect(higgsfieldExerciseChecklist).not.toEqual(higgsfieldAvatarChecklist);
  });
});
