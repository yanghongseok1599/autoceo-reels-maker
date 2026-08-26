import { describe, it, expect } from 'vitest';
import { resolveAudioSrc } from '../utils/audioSrc';

describe('resolveAudioSrc', () => {
  it('wraps a public-relative path so the render bundle serves it', () => {
    expect(resolveAudioSrc('generated-audio/ab.mp3')).toBe('/generated-audio/ab.mp3');
  });

  it('leaves an absolute http url alone', () => {
    const url = 'https://cdn.example/narration.mp3';
    expect(resolveAudioSrc(url)).toBe(url);
  });

  it('leaves data and blob urls alone', () => {
    expect(resolveAudioSrc('data:audio/mp3;base64,AAA')).toBe('data:audio/mp3;base64,AAA');
    expect(resolveAudioSrc('blob:http://x/y')).toBe('blob:http://x/y');
  });

  // 절대 파일 경로는 헤드리스 크롬이 404를 내고 영상만 조용히 무음이 된다. 던지는 편이 낫다.
  it('throws on an absolute filesystem path rather than rendering silence', () => {
    expect(() => resolveAudioSrc('/Users/op/repo/public/generated-audio/ab.mp3')).toThrow();
  });
});
