import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SubtitleJSON } from '@studio/video/src/types';
import type { ReelProps } from '@studio/video/src/types';

const synthesizeNarration = vi.fn();
const transcribeToSubtitles = vi.fn();
const renderReel = vi.fn();

vi.mock('@/lib/pipeline/tts', () => ({ synthesizeNarration: (...a: unknown[]) => synthesizeNarration(...a) }));
vi.mock('@/lib/pipeline/stt', () => ({ transcribeToSubtitles: (...a: unknown[]) => transcribeToSubtitles(...a) }));
vi.mock('../../worker/render', () => ({ renderReel: (...a: unknown[]) => renderReel(...a) }));

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
