import { describe, it, expect } from 'vitest';
import { parseWhisperJson } from '../pipeline/stt';

// 실제 whisper-cli 1.9.1 `-ojf` 출력에서 가져온 구조다. 특수 토큰 두 종류가 섞여 나온다.
const whisperOutput = {
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:04,900' },
      offsets: { from: 0, to: 4900 },
      text: ' 저는 운동을 좋아해서 뛰어요.',
      tokens: [
        { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
        { text: ' 저는', offsets: { from: 130, to: 550 } },
        { text: ' 운동', offsets: { from: 870, to: 1160 } },
        { text: '을', offsets: { from: 1160, to: 1380 } },
        { text: '[_TT_245]', offsets: { from: 4900, to: 4900 } },
      ],
    },
  ],
};

describe('parseWhisperJson', () => {
  it('converts milliseconds to seconds', () => {
    const [seg] = parseWhisperJson(whisperOutput);
    expect(seg.start).toBe(0);
    expect(seg.end).toBe(4.9);
  });

  it('extracts word-level timings from tokens, merging continuation tokens', () => {
    const [seg] = parseWhisperJson(whisperOutput);
    // " 저는" carries a leading space → its own word.
    expect(seg.words[0]).toEqual({ word: '저는', start: 0.13, end: 0.55 });
    // " 운동" starts a word; "을" has no leading space and joins it → "운동을".
    expect(seg.words[1]).toEqual({ word: '운동을', start: 0.87, end: 1.38 });
  });

  // whisper는 [_BEG_]와 [_TT_245] 같은 제어 토큰을 단어 사이에 섞어 낸다.
  // 거르지 않으면 자막에 그대로 찍힌다.
  it("filters whisper's special tokens", () => {
    const [seg] = parseWhisperJson(whisperOutput);
    const words = seg.words.map((w) => w.word);
    expect(words).not.toContain('[_BEG_]');
    expect(words).not.toContain('[_TT_245]');
    expect(words).toEqual(['저는', '운동을']);
  });

  // 루트 원인: whisper 서브워드 토큰의 유일한 단어 경계 신호는 "앞쪽 공백"이다.
  // trim() 만 하면 그 신호가 사라져 서브워드마다 별도 자막 조각이 생긴다.
  it('starts a new word only when the token has a leading space', () => {
    const raw = {
      transcription: [
        {
          text: '가나 다',
          offsets: { from: 0, to: 900 },
          tokens: [
            { text: ' 가', offsets: { from: 0, to: 200 } },
            { text: '나', offsets: { from: 200, to: 400 } },
            { text: ' 다', offsets: { from: 400, to: 900 } },
          ],
        },
      ],
    };
    const [seg] = parseWhisperJson(raw);
    expect(seg.words.map((w) => w.word)).toEqual(['가나', '다']);
  });

  it('does not split a word when a special token falls between continuation tokens', () => {
    const raw = {
      transcription: [
        {
          text: '가나',
          offsets: { from: 0, to: 400 },
          tokens: [
            { text: ' 가', offsets: { from: 0, to: 200 } },
            { text: '[_TT_200]', offsets: { from: 200, to: 200 } },
            { text: '나', offsets: { from: 200, to: 400 } },
          ],
        },
      ],
    };
    const [seg] = parseWhisperJson(raw);
    expect(seg.words).toEqual([{ word: '가나', start: 0, end: 0.4 }]);
  });

  it('treats the first token as a new word even without a leading space', () => {
    const raw = {
      transcription: [
        {
          text: '가',
          offsets: { from: 0, to: 200 },
          tokens: [{ text: '가', offsets: { from: 0, to: 200 } }],
        },
      ],
    };
    const [seg] = parseWhisperJson(raw);
    expect(seg.words).toEqual([{ word: '가', start: 0, end: 0.2 }]);
  });

  it("a merged word's end comes from the last token and start from the first", () => {
    const raw = {
      transcription: [
        {
          text: '가나다',
          offsets: { from: 0, to: 900 },
          tokens: [
            { text: ' 가', offsets: { from: 100, to: 200 } },
            { text: '나', offsets: { from: 200, to: 500 } },
            { text: '다', offsets: { from: 500, to: 900 } },
          ],
        },
      ],
    };
    const [seg] = parseWhisperJson(raw);
    expect(seg.words).toEqual([{ word: '가나다', start: 0.1, end: 0.9 }]);
  });

  it('trims surrounding whitespace from text', () => {
    expect(parseWhisperJson(whisperOutput)[0].text).toBe('저는 운동을 좋아해서 뛰어요.');
  });

  it('returns an empty array for malformed input', () => {
    expect(parseWhisperJson({})).toEqual([]);
    expect(parseWhisperJson(null)).toEqual([]);
  });

  it('survives a segment with no tokens at all', () => {
    const noTokens = { transcription: [{ offsets: { from: 0, to: 1000 }, text: '무음' }] };
    expect(parseWhisperJson(noTokens)[0].words).toEqual([]);
  });

  // whisper 출력 형식은 이미 세 번 우리 가정과 달랐다. 망가진 항목 하나가
  // 전체 전사를 죽이면 안 된다 — 그 실패는 잡 전체를 TypeError로 끝낸다.
  it('drops a segment missing its offsets instead of throwing', () => {
    const broken = {
      transcription: [
        { text: '멀쩡한 문장', offsets: { from: 0, to: 1000 }, tokens: [] },
        { text: 'offsets 없음' },
      ],
    };
    const parsed = parseWhisperJson(broken);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('멀쩡한 문장');
  });

  it('drops a segment missing its text instead of throwing', () => {
    const broken = { transcription: [{ offsets: { from: 0, to: 1000 } }] };
    expect(parseWhisperJson(broken)).toEqual([]);
  });

  it('drops a malformed token but keeps the good ones beside it', () => {
    const mixed = {
      transcription: [
        {
          text: '섞임',
          offsets: { from: 0, to: 1000 },
          tokens: [
            { text: ' 좋음', offsets: { from: 0, to: 400 } },
            { text: '깨짐' },
            { text: ' 또좋음', offsets: { from: 400, to: 900 } },
          ],
        },
      ],
    };
    expect(parseWhisperJson(mixed)[0].words.map((w) => w.word)).toEqual(['좋음', '또좋음']);
  });
});
