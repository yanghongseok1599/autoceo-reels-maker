import type { SceneDirective, SubtitleJSON } from '@studio/video/src/types';

type SceneType = SceneDirective['type'];

const LIST = /(첫째|둘째|셋째|[1-9][.)]\s)/;
const QUOTE = /["'「『]|라고/;
const SHORT = 12;

/**
 * LLM 없이 대본을 씬으로 전개한다. 규칙이라 결정론적이고 테스트가 가능하며 API 키가 필요 없다.
 * LLM 경로가 생기면 같은 반환 타입으로 이 함수를 대체하면 된다.
 *
 * 규칙은 순서가 곧 명세다. 위치 규칙(첫/마지막)이 언제나 내용 규칙보다 먼저이므로
 * 첫 세그먼트는 반드시 title_card, 마지막 세그먼트는 반드시 conclusion이 된다.
 * 세그먼트가 하나뿐이면 규칙 1이 먼저 걸려 ['title_card']만 남는다.
 */
export function planSceneTypes(subtitles: SubtitleJSON): SceneType[] {
  return subtitles.map((segment, index) => {
    if (index === 0) return 'title_card';
    if (index === subtitles.length - 1) return 'conclusion';

    const text = segment.text;
    if (LIST.test(text) || (text.match(/,/g) ?? []).length >= 2) return 'list_reveal';
    if (QUOTE.test(text)) return 'quote';
    if (text.replace(/\s/g, '').length <= SHORT) return 'emphasis';
    return 'content_slide';
  });
}
