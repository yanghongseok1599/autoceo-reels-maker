import { describe, it, expect, beforeEach, vi } from 'vitest';
import path from 'node:path';

/**
 * `synthesizeNarration`은 Fish Audio 호출을 감싸는 얇은 껍데기지만, **그 껍데기가 하는
 * 두 가지 변환이 렌더 성패를 가른다** — 실패를 실패로 알리는 것과, 경로를 Remotion이
 * 실제로 여는 형태로 바꾸는 것. 둘 다 여기 말고는 검사할 자리가 없다.
 */
const { synthesizeMock } = vi.hoisted(() => ({ synthesizeMock: vi.fn() }));
vi.mock('@/lib/fish-audio-client', () => ({ synthesizeFishSpeech: synthesizeMock }));

import { synthesizeNarration } from '../pipeline/tts';

const PUBLIC_DIR = '/tmp/reels-public-for-tts';
const input = { text: '오늘은 스쿼트를 배웁니다', referenceId: 'ref_1' };

beforeEach(() => {
  synthesizeMock.mockReset();
  process.env.PUBLIC_DIR = PUBLIC_DIR;
});

const resolves = (result: unknown) => synthesizeMock.mockResolvedValue(result);

describe('synthesizeNarration — 실패를 실패로 알린다', () => {
  it('합성이 error면 던진다 — 반환된 사유를 그대로', async () => {
    resolves({ generationId: 'g1', status: 'error', error: '레퍼런스 음성이 없습니다.' });
    await expect(synthesizeNarration(input)).rejects.toThrow('레퍼런스 음성이 없습니다.');
  });

  /** 사유가 없어도 조용히 넘어가지 않는다. 수강생이 보는 문구는 한국어 기본값이다. */
  it('사유 없는 error에는 한국어 기본 문구로 던진다', async () => {
    resolves({ generationId: 'g1', status: 'error' });
    await expect(synthesizeNarration(input)).rejects.toThrow('음성 합성에 실패했습니다.');
  });

  /**
   * error인데 URL이 딸려 오는 경우가 있다(중간까지 만들다 실패). 그 반쪽짜리 파일을
   * 나레이션으로 내보내면 렌더는 성공하고 소리만 잘려 나간다.
   */
  it('URL이 딸려 온 error도 성공으로 읽지 않는다', async () => {
    resolves({
      generationId: 'g1', status: 'error',
      audioUrl: '/generated-audio/half.mp3', error: '합성이 중단되었습니다.',
    });
    await expect(synthesizeNarration(input)).rejects.toThrow('합성이 중단되었습니다.');
  });

  /**
   * **소리 없는 렌더를 이미 한 번 내보낸 자리다.** status만 보고 URL을 안 보면,
   * 여기서 통과한 값이 `<Audio src>`까지 그대로 흘러간다.
   */
  it('status가 done이어도 audioUrl이 없으면 던진다', async () => {
    resolves({ generationId: 'g1', status: 'done' });
    await expect(synthesizeNarration(input)).rejects.toThrow('음성 합성에 실패했습니다.');
  });

  it('빈 문자열 audioUrl도 없는 것으로 본다', async () => {
    resolves({ generationId: 'g1', status: 'done', audioUrl: '' });
    await expect(synthesizeNarration(input)).rejects.toThrow('음성 합성에 실패했습니다.');
  });
});

describe('synthesizeNarration — 두 갈래 경로', () => {
  /** whisper.cpp에 넘길 값이다. 앱 public 루트 아래의 실제 디스크 경로여야 한다. */
  it('audioPath는 앱 public 디렉터리 아래의 디스크 경로다', async () => {
    resolves({ generationId: 'g1', status: 'done', audioUrl: '/generated-audio/a.mp3' });
    const { audioPath } = await synthesizeNarration(input);
    expect(audioPath).toBe(path.join(PUBLIC_DIR, '/generated-audio/a.mp3'));
    expect(audioPath).toBe('/tmp/reels-public-for-tts/generated-audio/a.mp3');
  });

  it('public 디렉터리가 바뀌면 audioPath도 따라 바뀐다', async () => {
    process.env.PUBLIC_DIR = '/tmp/another-public';
    resolves({ generationId: 'g1', status: 'done', audioUrl: '/generated-audio/a.mp3' });
    expect((await synthesizeNarration(input)).audioPath)
      .toBe('/tmp/another-public/generated-audio/a.mp3');
  });

  /**
   * **맨 앞 `/` 하나를 떼는 이 규칙 하나 때문에 소리 없는 렌더가 나간 적이 있다.**
   * Remotion의 `staticFile`/`<Audio src>`는 public 루트 **기준 상대 경로**만 연다.
   * `/generated-audio/a.mp3`를 그대로 주면 파일은 멀쩡한데 아무 소리도 나오지 않는다.
   */
  it('publicPath는 맨 앞 슬래시를 뗀 상대 경로다', async () => {
    resolves({ generationId: 'g1', status: 'done', audioUrl: '/generated-audio/a.mp3' });
    const { publicPath } = await synthesizeNarration(input);
    expect(publicPath).toBe('generated-audio/a.mp3');
    expect(publicPath.startsWith('/')).toBe(false);
  });

  /** 이미 상대 경로면 손대지 않는다 — 중간 슬래시까지 먹으면 경로가 통째로 깨진다. */
  it('슬래시로 시작하지 않는 값은 그대로 둔다', async () => {
    resolves({ generationId: 'g1', status: 'done', audioUrl: 'generated-audio/a.mp3' });
    expect((await synthesizeNarration(input)).publicPath).toBe('generated-audio/a.mp3');
  });

  it('맨 앞 슬래시 하나만 뗀다', async () => {
    resolves({ generationId: 'g1', status: 'done', audioUrl: '//generated-audio/a.mp3' });
    expect((await synthesizeNarration(input)).publicPath).toBe('/generated-audio/a.mp3');
  });

  /** 두 경로는 같은 파일을 가리키되 **형태가 달라야** 한다. 둘을 뒤바꾸면 렌더가 조용히 죽는다. */
  it('audioPath와 publicPath는 서로 다른 형태다', async () => {
    resolves({ generationId: 'g1', status: 'done', audioUrl: '/generated-audio/a.mp3' });
    const { audioPath, publicPath } = await synthesizeNarration(input);
    expect(audioPath).not.toBe(publicPath);
    expect(audioPath.endsWith(publicPath)).toBe(true);
  });

  it('호출자가 준 입력을 그대로 합성기에 넘긴다', async () => {
    resolves({ generationId: 'g1', status: 'done', audioUrl: '/generated-audio/a.mp3' });
    await synthesizeNarration({ ...input, speakingSpeed: 1.2, instruct: '차분하게' });
    expect(synthesizeMock).toHaveBeenCalledWith({
      text: '오늘은 스쿼트를 배웁니다',
      referenceId: 'ref_1',
      speakingSpeed: 1.2,
      instruct: '차분하게',
    });
  });
});
