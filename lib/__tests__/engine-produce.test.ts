import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SubtitleJSON } from '@studio/video/src/types';
import type { ReelProps } from '@studio/video/src/types';

const synthesizeNarration = vi.fn();
const transcribeToSubtitles = vi.fn();
const renderReel = vi.fn();
const copyClipart = vi.fn();

vi.mock('@/lib/pipeline/tts', () => ({ synthesizeNarration: (...a: unknown[]) => synthesizeNarration(...a) }));
vi.mock('@/lib/pipeline/stt', () => ({ transcribeToSubtitles: (...a: unknown[]) => transcribeToSubtitles(...a) }));
vi.mock('../../worker/render', () => ({
  renderReel: (...a: unknown[]) => renderReel(...a),
  copyClipart: (...a: unknown[]) => copyClipart(...a),
}));

const subtitles: SubtitleJSON = [
  { id: 0, text: '안녕하세요', start: 0, end: 2.5, words: [] },
  { id: 1, text: '오늘은 호흡법입니다', start: 2.5, end: 24.2, words: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  synthesizeNarration.mockResolvedValue({
    audioPath: '/Users/op/repo/public/generated-audio/ab.mp3',
    publicPath: 'generated-audio/ab.mp3',
  });
  transcribeToSubtitles.mockResolvedValue(subtitles);
  renderReel.mockResolvedValue(undefined);
  copyClipart.mockResolvedValue(undefined);
  // 운영자 기계에는 실제 프리셋 라이브러리가 있다. 빈 디렉터리를 가리켜, 이 검사가
  // 그 기계에 무엇이 들어 있는지에 따라 달라지지 않게 한다.
  process.env.CLIPART_PRESET_DIR = mkdtempSync(path.join(os.tmpdir(), 'engine-preset-'));
});

const input = {
  projectId: 'p1', ownerId: 'u1', script: '대본',
  voiceReferenceId: 'v1', outPath: '/tmp/job1.mp4',
};

async function produce() {
  const { remotionEngine } = await import('../engines/remotion');
  return remotionEngine.produce(input, () => {});
}

describe('remotionEngine.produce', () => {
  it('hands the renderer a public-relative audio path, never a filesystem path', async () => {
    await produce();
    const props = renderReel.mock.calls[0][0] as ReelProps;
    expect(props.audioUrl).toBe('generated-audio/ab.mp3');
    expect(props.audioUrl?.startsWith('/Users')).toBe(false);
  });

  it('takes the duration from the last subtitle', async () => {
    const result = await produce();
    expect(result.durationSec).toBe(24.2);
    expect((renderReel.mock.calls[0][0] as ReelProps).durationInSeconds).toBe(24.2);
  });

  it('returns the path it was told to render to', async () => {
    expect((await produce()).outputPath).toBe('/tmp/job1.mp4');
  });
});

/**
 * 캐릭터가 씬에 닿는 두 갈래를 여기서 본다. Task 1~4는 각자 제 자리를 검사했지만, 실제
 * 릴스에 캐릭터가 붙는지는 이 경로가 이어져야만 참이 된다.
 */
describe('remotionEngine.produce — 캐릭터', () => {
  it('gives the renderer no character when the catalog is empty', async () => {
    await produce();
    const props = renderReel.mock.calls[0][0] as ReelProps;
    expect(props.scenes.some((scene) => scene.characterImageUrl)).toBe(false);
    expect(copyClipart).toHaveBeenCalledWith([], expect.any(String));
  });

  /**
   * 수강생 그림은 `publish`가 이미 도달 가능하게 뒀다. 씬은 그 값을 그대로 받고, 워커에는
   * 복사 목록으로 넘어가되 `copyClipart`가 프리셋이 아닌 것을 건너뛴다.
   */
  it('hands a student image to the renderer exactly as publish stored it', async () => {
    const { addStudentClipart } = await import('../clipart-store');
    const saved = await addStudentClipart({
      id: 'c1', ownerId: 'u1', keyword: '호흡법', aliases: [],
      category: '건강', file: 'clipart/ab12.png',
    });

    await produce();
    const props = renderReel.mock.calls[0][0] as ReelProps;
    expect(props.scenes[1].characterImageUrl).toBe('clipart/ab12.png');
    expect(copyClipart).toHaveBeenCalledWith([saved], expect.any(String));
  });

  it('never lets another student see this student character', async () => {
    const { addStudentClipart } = await import('../clipart-store');
    await addStudentClipart({
      id: 'c1', ownerId: 'someone-else', keyword: '호흡법', aliases: [],
      category: '건강', file: 'clipart/ab12.png',
    });

    await produce();
    const props = renderReel.mock.calls[0][0] as ReelProps;
    expect(props.scenes.some((scene) => scene.characterImageUrl)).toBe(false);
  });
});

/**
 * 카탈로그를 못 읽는 것은 릴스를 못 만드는 것과 무게가 다르다. 대본도 나레이션도 멀쩡한
 * 작업이 캐릭터 조회 하나 때문에 실패하면 안 된다.
 */
describe('remotionEngine.produce with a catalog that will not load', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock('@/lib/clipart-store', () => ({
      catalogFor: () => Promise.reject(new Error('저장소 장애')),
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/lib/clipart-store');
    vi.resetModules();
  });

  it('still renders the reel, just without a character', async () => {
    await expect(produce()).resolves.toMatchObject({ outputPath: '/tmp/job1.mp4' });
    const props = renderReel.mock.calls[0][0] as ReelProps;
    expect(props.scenes.some((scene) => scene.characterImageUrl)).toBe(false);
  });
});

describe('remotionEngine.produce with an empty transcription', () => {
  beforeEach(() => transcribeToSubtitles.mockResolvedValue([]));

  it('fails the job instead of producing a 5-second subtitle-less video', async () => {
    const { EMPTY_TRANSCRIPTION_ERROR } = await import('../engines/remotion');
    await expect(produce()).rejects.toThrow(EMPTY_TRANSCRIPTION_ERROR);
  });

  it('explains the cause in Korean', async () => {
    await expect(produce()).rejects.toThrow(/자막을 하나도 추출하지 못했습니다/);
  });

  it('never reaches the renderer', async () => {
    await expect(produce()).rejects.toThrow();
    expect(renderReel).not.toHaveBeenCalled();
  });
});
