import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PRESET_OWNER_ID, loadPresetClipart, parsePresetCatalog, presetDir } from '../clipart-preset';
import { matchClipart } from '../clipart';
import committed from '../../data/preset-clipart-catalog.json';

type RawItem = {
  keyword: string; aliases?: string[]; category?: string; file?: string; status?: string;
};

/** 카탈로그 한 덩어리를 손질해 돌려준다. 파일을 쓰지 않는다 — 손질은 순수 함수가 한다. */
function parse(items: RawItem[]) {
  return parsePresetCatalog({
    version: 1,
    items: items.map((i) => ({
      status: 'ready', category: '감정', file: `assets/clipart/${i.keyword}.png`, aliases: [], ...i,
    })),
  });
}

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'clipart-preset-'));

beforeEach(() => { delete process.env.CLIPART_PRESET_DIR; });

/**
 * `presetDir()`이 가리키는 것은 이제 **그림 파일뿐**이다. 카탈로그는 저장소에 커밋돼 있다.
 * 워커(`worker/render.ts`의 `copyClipart`)가 여기에 항목의 `file`을 이어 붙여 원본을 찾으므로
 * 이 함수는 그대로 남아 있어야 한다.
 */
describe('presetDir', () => {
  it('defaults to the operator Codex skill directory', () => {
    expect(presetDir()).toBe(path.join(os.homedir(), '.codex', 'skills', 'character-clipart-library'));
  });

  it('is overridable so the worker machine can point elsewhere', () => {
    const dir = tmp();
    process.env.CLIPART_PRESET_DIR = dir;
    expect(presetDir()).toBe(dir);
  });

  it('is read at call time, not at import time', () => {
    const a = tmp();
    const b = tmp();
    expect(a).not.toBe(b);
    process.env.CLIPART_PRESET_DIR = a;
    expect(presetDir()).toBe(a);
    process.env.CLIPART_PRESET_DIR = b;
    expect(presetDir()).toBe(b);
  });
});

describe('parsePresetCatalog', () => {
  it('turns catalog items into preset-owned entries', () => {
    expect(parse([{ keyword: '걱정', aliases: ['불안', '고민'], category: '감정' }])).toEqual([{
      id: 'preset:걱정', ownerId: '__preset__', keyword: '걱정',
      aliases: ['불안', '고민'], category: '감정', source: 'preset',
      file: 'assets/clipart/걱정.png',
    }]);
  });

  it('accepts a top-level array as well as { items }', () => {
    const raw = [{ keyword: '걱정', aliases: [], category: '감정', file: 'assets/clipart/걱정.png', status: 'ready' }];
    expect(parsePresetCatalog(raw).map((e) => e.keyword)).toEqual(['걱정']);
  });

  it('skips items that are not ready', () => {
    expect(parse([{ keyword: '걱정' }, { keyword: '기쁨', status: 'pending' }]).map((e) => e.keyword))
      .toEqual(['걱정']);
  });

  it('survives a catalog of the wrong shape instead of throwing', () => {
    expect(parsePresetCatalog({ version: 1 })).toEqual([]);
    expect(parsePresetCatalog(null)).toEqual([]);
    expect(parsePresetCatalog('{ not json')).toEqual([]);
    expect(parsePresetCatalog(undefined)).toEqual([]);
  });

  it('skips an item with no file to point at', () => {
    expect(parse([{ keyword: '걱정', file: '' }])).toEqual([]);
  });
});

/**
 * 아래는 이 파일의 존재 이유다. Task 1이 실측 카탈로그(ready 104건, term 540개)로 재 본
 * 결과 현실적인 피트니스 대본 14문장 중 12개가 오검출했다. 빠진 캐릭터는 아무도 눈치채지
 * 못하지만 스쿼트 설명에 붙은 비 오는 캐릭터는 수강생이 발행한 릴스에 박힌 버그로 보인다.
 * 비대칭이 크므로 정밀도 쪽으로 세게 기운다.
 */
describe('parsePresetCatalog – 정밀도 방어', () => {
  it('drops a one-character alias', () => {
    expect(parse([{ keyword: '동의', aliases: ['예', '찬성'] }])[0].aliases).toEqual(['찬성']);
  });

  it('drops the whole entry when the keyword itself is one character', () => {
    // 키워드가 한 글자면 남는 건 별칭뿐인데, 그 항목은 `preset:비`라는 id로 `비`가 아닌
    // 이름을 달고 다니게 된다. 애초에 넣지 않는다.
    expect(parse([{ keyword: '비', aliases: ['우천', '장마'] }, { keyword: '걱정' }]).map((e) => e.keyword))
      .toEqual(['걱정']);
  });

  it('drops an empty alias so one bad row cannot swallow every scene', () => {
    // `''`는 모든 문장에 "들어 있다". 최소 길이 규칙이 이것도 같이 막는다.
    expect(parse([{ keyword: '운동', aliases: ['', '  ', '헬스'] }])[0].aliases).toEqual(['헬스']);
  });

  it('stops 비 from matching 준비 자세', () => {
    expect(matchClipart('준비 자세부터 잡아 볼게요', parse([{ keyword: '비', aliases: ['우천'] }]))).toBeNull();
  });

  it('stops 예 from matching 예방', () => {
    expect(matchClipart('부상을 예방하는 방법입니다', parse([{ keyword: '동의', aliases: ['예'] }]))).toBeNull();
  });

  it('stops 돈 from matching 돈다면', () => {
    expect(matchClipart('고관절이 안쪽으로 돈다면 잘못된 겁니다', parse([{ keyword: '돈', aliases: ['금전'] }]))).toBeNull();
  });

  it('keeps a legitimate two-character match alive', () => {
    // 정밀도를 올리다 정상 일치까지 죽이면 이 기능은 아무것도 못 한다.
    expect(matchClipart('무릎 통증을 걱정하십니다', parse([{ keyword: '걱정', aliases: ['불안'] }]))?.keyword)
      .toBe('걱정');
  });
});

/**
 * 솎아 낸 별칭들. 실측이 드러낸 오검출의 원인이고, 되돌리면 그대로 재발한다.
 * 넷 다 별칭이라 항목(그림)은 다른 별칭으로 계속 닿을 수 있다.
 */
describe('parsePresetCatalog – 솎아 낸 별칭', () => {
  it('drops 소식 from 뉴스 so a diet script is not the news', () => {
    const catalog = parse([{ keyword: '뉴스', aliases: ['소식', '보도', '기사'] }]);
    expect(catalog[0].aliases).toEqual(['보도', '기사']);
    expect(matchClipart('소식하는 습관이 체중을 바꿉니다', catalog)).toBeNull();
    expect(matchClipart('오늘의 보도를 정리했습니다', catalog)?.keyword).toBe('뉴스');
  });

  it('drops 화제 from 바이럴 so 소화제 is not viral', () => {
    const catalog = parse([{ keyword: '바이럴', aliases: ['입소문', '화제'] }]);
    expect(matchClipart('소화제에 의존하지 마세요', catalog)).toBeNull();
    expect(matchClipart('입소문이 퍼지고 있습니다', catalog)?.keyword).toBe('바이럴');
  });

  it('drops 기상 from 아침 so 기상청 is not morning', () => {
    const catalog = parse([{ keyword: '아침', aliases: ['기상', '아침 시간'] }]);
    expect(matchClipart('기상청 예보를 확인하세요', catalog)).toBeNull();
    expect(matchClipart('아침 시간에 하시면 좋습니다', catalog)?.keyword).toBe('아침');
  });

  it('drops 지침 from 피곤 so an exercise guideline is not fatigue', () => {
    const catalog = parse([{ keyword: '피곤', aliases: ['피로', '지침'] }]);
    expect(matchClipart('운동 지침에 따르면 주 3회입니다', catalog)).toBeNull();
    expect(matchClipart('피로가 쌓이면 이렇게 하세요', catalog)?.keyword).toBe('피곤');
  });

  it('never drops a curated word that is an entry keyword, only an alias', () => {
    // 운영자가 나중에 `기상`을 키워드로 쓰는 항목을 만들 수 있다. 그때 항목이 통째로
    // 사라지면 원인을 찾기 어렵다. 솎아 내기는 별칭에만 건다.
    expect(parse([{ keyword: '기상', aliases: ['아침'] }]).map((e) => e.keyword)).toEqual(['기상']);
  });
});

/**
 * 남는 오검출은 동음이의어다. 이건 못 고친다 — 그리고 고치려 들지 않는다.
 * 프리셋은 자기 캐릭터를 아직 안 올린 수강생의 대타일 뿐이고, 올린 수강생은 키워드를
 * 자기가 정하므로 자기 정밀도를 자기가 쥔다.
 */
describe('parsePresetCatalog – 감수하는 잔여 오검출', () => {
  it('documents that 사과 (apology) still matches 사과 (apple)', () => {
    expect(matchClipart('사과 한 개는 100칼로리입니다', parse([{ keyword: '사과', aliases: ['미안'] }]))?.keyword)
      .toBe('사과');
  });
});

/**
 * 커밋된 카탈로그 자체. 앱과 워커가 **같은 답**을 하기 위한 파일이므로, 여기서 보는 것은
 * 파일 하나가 아니라 "어느 프로세스에서 불러도 같은가"이다.
 */
describe('loadPresetClipart – 커밋된 카탈로그', () => {
  it('loads the operator library without touching the filesystem', async () => {
    const catalog = await loadPresetClipart();
    expect(catalog.length).toBeGreaterThan(100);
    expect(catalog.map((e) => e.keyword)).toContain('걱정');
    expect(catalog.every((e) => e.source === 'preset')).toBe(true);
    expect(catalog.every((e) => e.ownerId === PRESET_OWNER_ID)).toBe(true);
  });

  /**
   * `file`은 프리셋 디렉터리 기준 상대 경로로 남아야 한다. 워커가 `presetDir()`에 이어
   * 붙여 원본 바이트를 찾기 때문이다 — 커밋하는 것은 메타데이터지 그림이 아니다.
   */
  it('keeps every file path relative to the operator preset directory', async () => {
    const catalog = await loadPresetClipart();
    expect(catalog.every((e) => e.file.startsWith('assets/'))).toBe(true);
    expect(catalog.some((e) => path.isAbsolute(e.file))).toBe(false);
  });

  /**
   * **손질은 정확히 한 번, 로더에서만 걸린다.** 커밋본은 실측 카탈로그의 투영일 뿐이라
   * 아직 손질되지 않은 항목을 그대로 담고 있어야 하고(아래 raw 검사), 로드 결과에는
   * 하나도 남아 있지 않아야 한다. 동기화 스크립트가 미리 걸러 버리면 앞쪽이 깨지고,
   * 로더가 손을 놓으면 뒤쪽이 깨진다.
   */
  it('commits the catalog raw and curates it exactly once, at load time', async () => {
    const raw = committed.items;
    expect(raw.some((i) => i.status !== 'ready')).toBe(true);
    expect(raw.some((i) => i.keyword.trim().length < 2)).toBe(true);
    expect(raw.some((i) => (i.aliases ?? []).includes('소식'))).toBe(true);

    const catalog = await loadPresetClipart();
    const keywords = new Set(catalog.map((e) => e.keyword));
    const pending = raw.filter((i) => i.status !== 'ready').map((i) => i.keyword);
    expect(pending.some((keyword) => keywords.has(keyword))).toBe(false);
    expect(catalog.every((e) => e.keyword.trim().length >= 2)).toBe(true);
    expect(catalog.every((e) => e.aliases.every((a) => a.trim().length >= 2))).toBe(true);
    for (const curated of ['소식', '화제', '기상', '지침']) {
      expect(catalog.some((e) => e.aliases.includes(curated))).toBe(false);
    }
  });

  it('does not read CLIPART_PRESET_DIR — that variable is for image bytes only', async () => {
    const before = (await loadPresetClipart()).map((e) => e.keyword);
    process.env.CLIPART_PRESET_DIR = path.join(os.tmpdir(), 'nope-' + Date.now());
    expect((await loadPresetClipart()).map((e) => e.keyword)).toEqual(before);
  });
});
