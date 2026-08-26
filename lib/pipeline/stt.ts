import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { SubtitleJSON, SubtitleSegment, SubtitleWord } from '@studio/video/src/types';

const run = promisify(execFile);

/** whisper.cpp가 단어 사이에 섞어 내는 제어 토큰: [_BEG_], [_TT_245] 등 */
const SPECIAL_TOKEN = /^\[.*\]$/;

interface WhisperToken { text: string; offsets: { from: number; to: number } }
interface WhisperSegment { text: string; offsets: { from: number; to: number }; tokens?: WhisperToken[] }

function hasSpan(x: unknown): x is { offsets: { from: number; to: number } } {
  const o = (x as { offsets?: { from?: unknown; to?: unknown } })?.offsets;
  return typeof o?.from === 'number' && typeof o?.to === 'number';
}

/**
 * whisper는 단어를 여러 서브워드 토큰으로 쪼개 내보내는데, 그 경계 신호는
 * 토큰 텍스트의 "앞쪽 공백" 하나뿐이다 (예: " 저는", " 운동", "을" → 저는/운동을).
 * 여기서 trim 해버리면 그 신호가 사라져 매 서브워드가 별도 자막 조각으로 렌더링된다.
 * 앞 공백이 있으면 새 단어를 시작하고, 없으면 직전 단어에 이어 붙인다.
 * 특수 토큰은 병합 흐름을 건드리지 않고 건너뛴다 — 중간에 끼어도 앞뒤 토큰은 그대로 이어진다.
 */
function mergeTokensIntoWords(tokens: unknown[]): SubtitleWord[] {
  const words: SubtitleWord[] = [];
  for (const token of tokens) {
    if (!hasSpan(token) || typeof (token as WhisperToken).text !== 'string') continue;
    const raw = (token as WhisperToken).text;
    const text = raw.trim();
    if (!text || SPECIAL_TOKEN.test(text)) continue;

    const { from, to } = (token as WhisperToken).offsets;
    const startsNewWord = /^\s/.test(raw) || words.length === 0;
    if (startsNewWord) {
      words.push({ word: text, start: from / 1000, end: to / 1000 });
    } else {
      const previous = words[words.length - 1];
      previous.word += text;
      previous.end = to / 1000;
    }
  }
  return words;
}

/**
 * 외부 바이너리의 출력을 파싱한다. 형식이 우리 가정과 다른 적이 이미 세 번 있었으므로
 * 망가진 항목 하나가 전체 전사를 죽이지 않도록 걸러낸다.
 */
export function parseWhisperJson(raw: unknown): SubtitleJSON {
  const segments = (raw as { transcription?: unknown[] })?.transcription;
  if (!Array.isArray(segments)) return [];

  return segments
    .filter(
      (seg): seg is WhisperSegment =>
        typeof (seg as WhisperSegment)?.text === 'string' && hasSpan(seg),
    )
    .map((seg, id): SubtitleSegment => ({
      id,
      text: seg.text.trim(),
      start: seg.offsets.from / 1000,
      end: seg.offsets.to / 1000,
      words: mergeTokensIntoWords(seg.tokens ?? []),
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
