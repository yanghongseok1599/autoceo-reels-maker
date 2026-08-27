import { describe, it, expect } from 'vitest';
import { matchClipart, clipartAssetKey, type ClipartEntry } from '../clipart';

const entry = (keyword: string, aliases: string[], file: string): ClipartEntry => ({
  id: `c-${keyword}`, ownerId: 'u1', keyword, aliases,
  category: '감정', source: 'preset', file,
});

const catalog = [
  entry('걱정', ['불안', '고민', 'worried'], 'assets/clipart/걱정.png'),
  entry('건강', ['건강하다', '컨디션'], 'assets/clipart/건강.png'),
  entry('운동', ['헬스'], 'assets/clipart/운동.png'),
];

describe('matchClipart', () => {
  it('matches on the keyword itself', () => {
    expect(matchClipart('무릎 통증을 걱정하십니다', catalog)?.keyword).toBe('걱정');
  });

  it('matches on an alias', () => {
    expect(matchClipart('많이 불안하시죠', catalog)?.keyword).toBe('걱정');
  });

  it('returns null when nothing matches', () => {
    expect(matchClipart('발바닥을 바닥에 누르세요', catalog)).toBeNull();
  });

  // 짧은 단어가 긴 단어 안에 우연히 들어가는 일이 잦다. 긴 일치가 이겨야 한다.
  it('prefers the longest match', () => {
    expect(matchClipart('건강하다고 느끼세요', catalog)?.keyword).toBe('건강');
  });

  it('is not confused by an empty string', () => {
    expect(matchClipart('', catalog)).toBeNull();
  });

  it('returns null for an empty catalog', () => {
    expect(matchClipart('걱정됩니다', [])).toBeNull();
  });
});

describe('clipartAssetKey', () => {
  it('produces an ascii-safe public path', () => {
    expect(clipartAssetKey(catalog[0])).toMatch(/^clipart\/[0-9a-f]{10}\.png$/);
  });

  it('is stable for the same entry', () => {
    expect(clipartAssetKey(catalog[0])).toBe(clipartAssetKey(catalog[0]));
  });

  it('differs between entries', () => {
    expect(clipartAssetKey(catalog[0])).not.toBe(clipartAssetKey(catalog[1]));
  });
});

/**
 * 여기부터는 브리프 밖에서 덧붙인 검사다. 이 저장소는 한국어 부분 일치로 이미 두 번 데었다
 * (`라고`가 평범한 동사 `자라고`·`바라고`를 물었고, 목록 표지 `1.`이 `3.5킬로그램`을 물었다).
 * 같은 모양의 사고가 여기서도 나는지 눌러 본다.
 */
describe('matchClipart – 한국어 부분 일치의 위험', () => {
  it('lets a longer term on a later entry beat a shorter one on an earlier entry', () => {
    // 카탈로그 순서대로 첫 일치를 집으면 `고민`(걱정)이 이긴다. 문장이 말하는 건 건강이다.
    expect(matchClipart('고민 없이 건강하다고 느끼세요', catalog)?.keyword).toBe('건강');
  });

  it('is null for whitespace-only text', () => {
    expect(matchClipart('   \n  ', catalog)).toBeNull();
  });

  it('ignores an empty alias instead of matching every scene', () => {
    // `''`는 어떤 문자열에도 들어 있다. 카탈로그 JSON에 빈 별칭이 한 줄 섞이면
    // 그 캐릭터가 모든 씬을 먹는다. Task 2가 파일에서 읽어 만들 예정이라 실제 위험이다.
    const broken = [entry('운동', [''], 'assets/clipart/운동.png')];
    expect(matchClipart('발바닥을 바닥에 누르세요', broken)).toBeNull();
  });

  /**
   * 아래 셋은 **고쳐진 동작이 아니라 현재 동작**을 박아 둔 기록이다. 쓰인 낱말은 지어낸 게
   * 아니라 실제 운영자 프리셋 카탈로그에 들어 있는 term이다(`비`·`예`·`소식`).
   *
   * 한국어는 조사·어미가 붙어 늘어나므로 `걱정합니다`를 잡으려면 부분 일치가 필수인데,
   * 바로 그 이유로 낱말 경계를 요구할 수가 없다. 긴 일치 우선도 여기선 못 막는다 —
   * 경쟁할 더 긴 term이 카탈로그에 아예 없기 때문이다.
   * 지금의 방어는 코드가 아니라 카탈로그 선정이다: 흔한 낱말의 조각이 되는 키워드를 빼야 한다.
   */
  it('documents a 1-syllable false positive longest-match cannot fix: 비 ⊂ 준비', () => {
    // `비`(rain)는 준비·대비·비타민에 다 들어 있다. `준비 자세`는 이 앱의 대본에 늘 나온다.
    const rain = [entry('비', ['우천', '장마'], 'assets/clipart/비.png')];
    expect(matchClipart('준비 자세부터 잡아 볼게요', rain)?.keyword).toBe('비');
  });

  it('documents a 2-syllable false positive: 소식(뉴스) ⊂ 소식하다(eat lightly)', () => {
    // 식단 대본에서 `소식하는 습관`은 뉴스가 아니다. 더 긴 경쟁 term이 없어 그대로 걸린다.
    const news = [entry('뉴스', ['소식', '보도'], 'assets/clipart/뉴스.png')];
    expect(matchClipart('소식하는 습관이 체중을 바꿉니다', news)?.keyword).toBe('뉴스');
  });

  it('resolves a tie by catalog order, deterministically', () => {
    // 길이가 같으면 앞선 항목이 이긴다(`>` 비교라 뒤엣것이 밀어내지 못한다). 좋은 답이라서가
    // 아니라 **정해진 답**이라서 박아 둔다 — 뒤 Task들이 같은 대본에 같은 그림을 기대한다.
    const tied = [
      entry('운동', ['헬스'], 'assets/clipart/운동.png'),
      entry('피곤', ['지침'], 'assets/clipart/피곤.png'),
    ];
    expect(matchClipart('운동 지침에 따르면 주 3회입니다', tied)?.keyword).toBe('운동');
  });
});

describe('clipartAssetKey – 무엇을 정체성으로 삼는가', () => {
  it('keys on the entry id, not the file', () => {
    // 프리셋 한 장을 여러 항목이 가리켜도 키가 갈려야 한다. 소유자가 다르면 파일도 따로 간다 —
    // 키를 `file`로 잡으면 남의 항목과 같은 자리를 쓰게 된다.
    const preset = { ...catalog[0], id: 'preset:걱정', ownerId: '__preset__' };
    const mine = { ...catalog[0], id: 'stu-1:걱정' };
    expect(clipartAssetKey(preset)).not.toBe(clipartAssetKey(mine));
  });
});
