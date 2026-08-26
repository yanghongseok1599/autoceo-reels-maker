import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { SubtitleJSON, SubtitleSegment } from '@studio/video/src/types';

const run = promisify(execFile);

/** whisper.cpp가 단어 사이에 섞어 내는 제어 토큰: [_BEG_], [_TT_245] 등 */
const SPECIAL_TOKEN = /^\[.*\]$/;

interface WhisperToken { text: string; offsets: { from: number; to: number } }
interface WhisperSegment { text: string; offsets: { from: number; to: number }; tokens?: WhisperToken[] }

export function parseWhisperJson(raw: unknown): SubtitleJSON {
  const segments = (raw as { transcription?: WhisperSegment[] })?.transcription;
  if (!Array.isArray(segments)) return [];

  return segments.map((seg, id): SubtitleSegment => ({
    id,
    text: seg.text.trim(),
    start: seg.offsets.from / 1000,
    end: seg.offsets.to / 1000,
    words: (seg.tokens ?? [])
      .map((token) => ({
        word: token.text.trim(),
        start: token.offsets.from / 1000,
        end: token.offsets.to / 1000,
      }))
      .filter((w) => w.word.length > 0 && !SPECIAL_TOKEN.test(w.word)),
  }));
}

export async function transcribeToSubtitles(audioPath: string): Promise<SubtitleJSON> {
  const model = process.env.WHISPER_MODEL;
  if (!model) {
    throw new Error(
      'WHISPER_MODEL이 설정되지 않았습니다. ggml 모델 파일의 절대 경로를 지정해주세요.',
    );
  }

  const outPrefix = `${audioPath}.whisper`;
  await run(process.env.WHISPER_BIN ?? 'whisper-cli', [
    '-m', model,
    '-l', 'ko',
    // -ojf 여야 한다. -oj 는 tokens 를 주지 않아 단어 타이밍을 못 얻는다.
    '-ojf',
    // -ml 은 쓰지 않는다. -ml 1 은 한국어 멀티바이트 문자를 바이트 경계에서 잘라 JSON을 깨뜨린다.
    '-of', outPrefix,
    '-f', audioPath,
  ]);

  return parseWhisperJson(JSON.parse(await readFile(`${outPrefix}.json`, 'utf8')));
}
