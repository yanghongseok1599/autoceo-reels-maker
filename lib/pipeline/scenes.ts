import type { SubtitleJSON, SubtitleSegment, SceneDirective } from '@studio/video/src/types';
import { planSceneTypes } from './scene-plan';
import { pickBackground, type StyleSheet } from '../style-sheet';

type SceneType = SceneDirective['type'];

/** 아래에 다른 블록이 딸리는 제목의 상한: 본문 슬라이드 제목, 목록 말머리, 강조 키워드 */
const MAX_TITLE = 40;

/**
 * 타이틀 카드와 마무리 카드의 표제 상한. `MAX_TITLE`보다 큰 이유는 이 두 카드에는 표제
 * 아래에 다른 텍스트 블록이 없어서 표제 하나가 화면을 다 쓸 수 있기 때문이다.
 *
 * 40은 레이아웃 한계가 아니었다. 1080x1920으로 실제 렌더해 보면 46자 제목은 72px에서 세 줄
 * (y≈800~1060), 50자 마무리는 64px에서 세 줄(y≈840~1070)로 들어간다 — 하단 자막 밴드
 * (y≥1633)와 500px 넘게 떨어져 있다. 64자면 네 줄 남짓으로, 아직 "표제"로 읽히는 마지막
 * 지점이다. 그보다 긴 꼬리는 버리지 않고 subtitle / callToAction으로 내려보낸다.
 */
const MAX_HEADLINE = 64;

/** 자막이 하나도 없을 때 만드는 타이틀 카드의 길이(초) */
const FALLBACK_SECONDS = 5;

/**
 * 목록 항목 상한. Task 2의 `getStaggerTiming`은 항목이 몇 개든 씬 안에 다 넣으려고 간격을
 * 줄이므로 잘리지는 않지만, 간격이 충분히 좁아지면 "순차 등장"이 "동시 등장"으로 보인다.
 *
 * 가장 짧은 목록 씬을 1.5초(45프레임)로 잡으면 등장 예산은 25프레임이다.
 * 5항목이면 항목당 6프레임(0.2초)이 남지만 6항목이면 5프레임, 8항목이면 3프레임으로 떨어진다.
 * 세로 1080x1920에서 하단 자막 밴드를 피해 40px 글자로 읽히는 줄 수도 5줄 남짓이다.
 * 두 제약이 같은 숫자를 가리키므로 5로 자른다. 넘치는 항목은 버린다 — 나레이션은 그대로
 * 읽히고, 화면에 다 띄워 봐야 짧은 릴스에서 읽히지 않는다.
 */
const MAX_ITEMS = 5;

/** 순서 표지. `[.)]` 뒤에 숫자가 오면 소수점이므로 제외한다 — `3.5킬로그램`은 목록이 아니다 */
const ORDINAL = '첫째|둘째|셋째|넷째|다섯째|여섯째|일곱째|여덟째|아홉째|열째';
const MARKER = new RegExp(`(?:${ORDINAL}|[1-9][.)](?!\\d))`);
const ITEM_SEPARATOR = new RegExp(`\\s*(?:,|${ORDINAL}|[1-9][.)](?!\\d))\\s*`, 'g');
const QUOTE_MARKS = /["'「『」』]/g;

/**
 * 넘치는 꼬리를 담을 필드가 **없는** 자리에서만 쓴다. 어절 경계에서 자르고 말줄임표를
 * 붙여, 잘렸다는 사실을 화면에 남긴다 — 조용히 사라지는 것보다 낫다.
 */
function truncate(text: string, limit: number = MAX_TITLE): string {
  const { head, tail } = cutAtWord(text.trim(), limit - 1);
  return tail ? `${head}…` : head;
}

/** 쉼표와 순서 표지로 나눈다. 빈 항목은 버리고, 읽히는 개수까지만 남긴다 */
function splitItems(text: string): string[] {
  const parts = text.split(ITEM_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  // 구분자만 있고 알맹이가 없으면(`,,,`) 원문을 통째로 한 항목으로 둔다 — 빈 목록보다 낫다
  return (parts.length ? parts : [text.trim()]).slice(0, MAX_ITEMS);
}

/**
 * 목록 문장을 제목과 항목으로 가른다. 순서 표지 앞의 말머리만 제목이 된다:
 * `순서는 이렇습니다 첫째 A, 둘째 B` → 제목 `순서는 이렇습니다`.
 * 쉼표만으로 이어진 목록은 말머리 자체가 첫 항목이므로 제목이 비는 게 맞다.
 */
function splitList(text: string): { title: string; items: string[] } {
  const marker = text.search(MARKER);
  const head = marker > 0 ? text.slice(0, marker) : '';
  return {
    title: truncate(head.replace(/[,·:;]\s*$/, '')),
    items: splitItems(marker > 0 ? text.slice(marker) : text),
  };
}

/** 상한을 넘으면 어절 경계에서 한 번 자른다. 꼬리는 버리지 않고 그대로 돌려준다 */
function cutAtWord(text: string, limit: number = MAX_TITLE): { head: string; tail: string } {
  if (text.length <= limit) return { head: text, tail: '' };
  const space = text.lastIndexOf(' ', limit);
  const cut = space > 0 ? space : limit;
  return { head: text.slice(0, cut).trim(), tail: text.slice(cut).trim() };
}

/**
 * 본문 한 문장을 제목(첫 절)과 불릿(나머지 절)으로 가른다. ContentSlide는 heading을 언제나
 * 그리므로 빈 제목을 넘기지 않는다.
 *
 * 제목이 길면 `truncate`로 잘라 버리면 안 된다. content_slide가 받는 문장은 쉼표가 많아야
 * 하나다(둘 이상이면 list_reveal로 간다) — 그래서 "첫 절이 긴" 문장이 이 씬 타입의 예외가
 * 아니라 **보통 모양**이다. 잘라 버리면 릴스마다 문장 끝이 조용히 사라지는데, 화면만 봐서는
 * 아무 이상이 없어 보인다. 그래서 절이 하나든 둘이든 규칙은 하나다: 넘치는 꼬리는
 * 잘라 버리지 않고 불릿 맨 앞으로 밀어 넣는다.
 */
function splitLead(text: string): { lead: string; body: string[] } {
  const clauses = text.split(',').map((clause) => clause.trim()).filter(Boolean);
  const { head, tail } = cutAtWord(clauses[0] ?? text);
  const rest = clauses.slice(1);
  return { lead: head, body: tail ? [tail, ...rest] : rest };
}

/**
 * 세그먼트 텍스트를 씬 타입별 필드로 옮긴다. `span`은 세그먼트의 시간이 아니라 타일링된
 * 시간이다 — 버려진 빈 세그먼트와 세그먼트 사이의 틈까지 이웃 씬이 흡수한 뒤의 값이다.
 */
function sceneFromSegment(
  type: SceneType,
  segment: SubtitleSegment,
  span: { startTime: number; endTime: number },
  sheet: StyleSheet,
  index: number,
): SceneDirective {
  const base = {
    ...span,
    colorAccent: sheet.palette.accent,
    backgroundImageUrl: pickBackground(sheet, index),
  };
  const text = segment.text.trim();

  switch (type) {
    /**
     * 표제 카드 두 종류는 규칙이 같다: 상한을 넘으면 **어절 경계**에서 한 번 자르고, 꼬리는
     * 버리지 않고 둘째 줄 필드로 내려보낸다. 릴스에서 가장 오래 보이는 첫 프레임과 마지막
     * 프레임에서 문장 끝이 조용히 사라지면 화면만 봐서는 아무 이상이 없어 보인다 —
     * content_slide가 이미 같은 이유로 자르기를 버렸다.
     */
    case 'title_card': {
      const { head, tail } = cutAtWord(text, MAX_HEADLINE);
      return { ...base, type, title: head, subtitle: tail || undefined };
    }
    case 'conclusion': {
      const { head, tail } = cutAtWord(text, MAX_HEADLINE);
      return { ...base, type, heading: head, callToAction: tail || undefined };
    }
    case 'emphasis': return { ...base, type, keyword: truncate(text) };
    case 'quote': {
      // 따옴표만으로 이루어진 세그먼트면 벗겨 낸 결과가 빈 문자열이다 — 그땐 원문을 쓴다
      const stripped = text.replace(QUOTE_MARKS, '').trim();
      return { ...base, type, quote: stripped || text };
    }
    case 'list_reveal': {
      const { title, items } = splitList(text);
      return { ...base, type, title, items };
    }
    case 'content_slide': {
      const { lead, body } = splitLead(text);
      return { ...base, type, heading: lead, bullets: body };
    }
  }
}

/** 세그먼트가 없거나 전부 공백일 때의 최후 수단. 대본 첫머리로 카드 하나를 만든다 */
function scriptTitleCard(
  subtitles: SubtitleJSON, script: string, sheet: StyleSheet,
): SceneDirective {
  return {
    type: 'title_card',
    // 첫 씬은 언제나 0초에서 시작한다 — buildScenes의 클램프와 같은 이유다
    startTime: 0,
    endTime: subtitles.length ? subtitles[subtitles.length - 1].end : FALLBACK_SECONDS,
    // 대본 전체는 카드 한 장에 담기지 않는다. 여기서는 꼬리를 내려보낼 데가 아니라
    // 잘렸다는 표시가 필요하다 — 어절 경계에서 자르고 말줄임표를 붙인다.
    title: truncate(script, MAX_HEADLINE),
    colorAccent: sheet.palette.accent,
    backgroundImageUrl: pickBackground(sheet, 0),
  };
}

/**
 * 자막 세그먼트마다 씬을 하나씩 만든다. 타입은 `planSceneTypes`가 정하고, 여기서는
 * 그 계획과 세그먼트를 인덱스로 맞물려 텍스트를 씬 필드로 옮긴다.
 *
 * 씬은 오디오를 빈틈도 겹침도 없이 덮는다. 세그먼트의 `end`를 그대로 쓰지 않고 **다음
 * 씬의 시작**을 끝으로 삼기 때문이다. STT가 세그먼트 사이에 남긴 숨소리 구간이나 아래에서
 * 버린 빈 세그먼트의 구간을 앞 씬이 그대로 흡수한다. 그렇지 않으면 그 틈에 활성 씬이 없어
 * SceneRouter가 빈 화면을 그린다.
 *
 * 첫 씬은 첫 세그먼트의 `start`가 아니라 **0초**에서 시작한다. TTS 오디오는 말이 나오기 전에
 * 한 박자 침묵이 있어 whisper의 첫 세그먼트가 0.3~0.8초에서 시작하는 일이 흔하다. 그대로 두면
 * 릴스에서 가장 값비싼 첫 프레임이 검은 화면으로 나간다 — 그 반 초가 끝까지 볼지를 정한다.
 * 클램프는 첫 씬을 **앞으로만** 늘린다: 끝과 그 뒤의 씬은 손대지 않으므로 타일링은 그대로다.
 *
 * 공백뿐인 세그먼트는 씬으로 만들지 않는다. `planSceneTypes`는 배열 길이를 세그먼트와
 * 맞춰야 해서 빈 세그먼트에도 타입을 돌려주지만, 그대로 씬을 만들면 키워드가 빈 emphasis
 * 씬이 그 길이만큼 빈 화면으로 나간다. 계획을 세우기 **전에** 걸러 내므로 위치 규칙
 * (첫 세그먼트=타이틀, 마지막=마무리)도 살아남은 세그먼트 기준으로 제대로 적용된다.
 */
export function buildScenes(input: {
  subtitles: SubtitleJSON; script: string; sheet: StyleSheet;
}): SceneDirective[] {
  const { subtitles, script, sheet } = input;
  const kept = subtitles.filter((segment) => segment.text.trim().length > 0);
  if (!kept.length) return [scriptTitleCard(subtitles, script, sheet)];

  const plan = planSceneTypes(kept);
  const audioEnd = subtitles[subtitles.length - 1].end;

  return kept.map((segment, i) => sceneFromSegment(
    plan[i],
    segment,
    {
      startTime: i === 0 ? 0 : segment.start,
      endTime: i === kept.length - 1 ? audioEnd : kept[i + 1].start,
    },
    sheet,
    i,
  ));
}

export async function generateScenes(input: {
  script: string; subtitles: SubtitleJSON; sheet: StyleSheet;
}): Promise<SceneDirective[]> {
  // 씬 전개는 규칙 기반이다: `planSceneTypes`가 세그먼트마다 씬 타입을 고르고 `buildScenes`가
  // 자막 텍스트를 그 타입의 필드로 옮긴다. 결정론적이고 API 키도 네트워크도 필요 없어서
  // 이 함수는 실패하지 않는다 — 그래서 async지만 await할 것이 없다.
  //
  // LLM 경로가 생긴다면 여기가 자리다: sheet.toneWords와 sheet.palette를 프롬프트에 넣어
  // 씬 타입과 문구를 뽑고, 호출이 실패하거나 스키마 검증에 걸리면 buildScenes로 되돌린다.
  // 반환 타입은 그대로 유지해야 lib/engines/remotion.ts가 영향을 받지 않는다.
  return buildScenes(input);
}
