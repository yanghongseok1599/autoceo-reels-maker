import type { SubtitleJSON, SceneDirective } from '@studio/video/src/types';
import { pickBackground, type StyleSheet } from '../style-sheet';

const MAX_TITLE = 40;

function truncate(text: string): string {
  const clean = text.trim();
  return clean.length <= MAX_TITLE ? clean : `${clean.slice(0, MAX_TITLE - 1)}…`;
}

export function buildFallbackScenes(
  subtitles: SubtitleJSON,
  script: string,
  sheet: StyleSheet,
): SceneDirective[] {
  const end = subtitles.length ? subtitles[subtitles.length - 1].end : 5;
  const title = truncate(subtitles.length ? subtitles[0].text : script);
  return [{
    type: 'title_card',
    startTime: 0,
    endTime: end,
    title,
    colorAccent: sheet.palette.accent,
    backgroundImageUrl: pickBackground(sheet, 0),
  }];
}

export async function generateScenes(input: {
  script: string; subtitles: SubtitleJSON; sheet: StyleSheet;
}): Promise<SceneDirective[]> {
  // 계획 1에서는 씬이 title_card 1종이므로 LLM 호출 없이 폴백만 사용한다.
  // 계획 2에서 씬 6종을 구현할 때 여기에 LLM 경로를 추가한다. 그때 프롬프트에
  // sheet.toneWords와 sheet.palette를 주입해야 장면 간 분위기가 유지된다.
  // LLM 실패 시에는 반드시 buildFallbackScenes로 되돌린다.
  return buildFallbackScenes(input.subtitles, input.script, input.sheet);
}
