import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SubtitleJSON } from '@studio/video/src/types';
import type { ReelProps } from '@studio/video/src/types';
import { clipartAssetKey, type ClipartEntry } from '../clipart';
import { PRESET_OWNER_ID } from '../clipart-preset';

/**
 * 프리셋 카탈로그를 이 파일이 직접 정한다. 운영자 기계에는 실제 라이브러리(104건)가 있고
 * 저장소에도 그 메타데이터가 커밋돼 있으므로, 모의하지 않으면 이 검사들이 운영자가 캐릭터를
 * 추가할 때마다 흔들린다. 여기서 볼 것은 카탈로그의 내용이 아니라 **카탈로그가 씬까지
 * 닿는 두 갈래**(프리셋 복사 / 수강생 publish)다.
 */
const preset = vi.hoisted(() => ({ entries: [] as unknown[] }));

vi.mock('../clipart-preset', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../clipart-preset')>()),
  loadPresetClipart: () => Promise.resolve(preset.entries),
}));

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
  copyClipart.mockResolvedValue([]);
  preset.entries = [];
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
 * 프리셋 카탈로그를 이 키워드 하나로 채우고, 워커가 옮겨야 할 자리(`clipartAssetKey`)를
 * 돌려준다. **그림 파일은 만들지 않는다** — 복사가 실패하는 상황이 여기서 확인할 상황이고,
 * 복사 자체는 `copyClipart`가 모의되어 있으므로 무엇을 돌려주느냐로 성공·실패를 정한다.
 */
function presetCatalog(keyword: string): string {
  const entry: ClipartEntry = {
    id: `preset:${keyword}`, ownerId: PRESET_OWNER_ID, keyword, aliases: [],
    category: '건강', source: 'preset', file: `assets/clipart/${keyword}.png`,
  };
  preset.entries = [entry];
  return clipartAssetKey(entry);
}

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

  /**
   * 프리셋 그림을 못 옮겼는데 씬이 그대로 그 자리를 가리키면, 렌더러는 프레임마다 404를
   * 재시도한 끝에 렌더를 중단한다. 복사 결과를 되먹이는 이유가 이것이다.
   */
  it('strips a preset character the worker could not copy', async () => {
    const key = presetCatalog('호흡법');
    copyClipart.mockResolvedValue([]);

    await produce();
    const props = renderReel.mock.calls[0][0] as ReelProps;
    expect(props.scenes.some((scene) => scene.characterImageUrl === key)).toBe(false);
    expect(props.scenes.some((scene) => scene.characterImageUrl)).toBe(false);
  });

  it('keeps a preset character the worker did copy', async () => {
    const key = presetCatalog('호흡법');
    copyClipart.mockResolvedValue([key]);

    await produce();
    const props = renderReel.mock.calls[0][0] as ReelProps;
    expect(props.scenes[1].characterImageUrl).toBe(key);
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
