import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadPresetClipart, presetDir } from '../clipart-preset';
import { matchClipart } from '../clipart';

type RawItem = {
  keyword: string; aliases?: string[]; category?: string; file?: string; status?: string;
};

function seedRaw(body: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'clipart-preset-'));
  mkdirSync(path.join(dir, 'assets'), { recursive: true });
  writeFileSync(path.join(dir, 'assets', 'catalog.json'), typeof body === 'string' ? body : JSON.stringify(body));
  process.env.CLIPART_PRESET_DIR = dir;
  return dir;
}

function seed(items: RawItem[]): string {
  return seedRaw({
    version: 1,
    items: items.map((i) => ({
      status: 'ready', category: '감정', file: `assets/clipart/${i.keyword}.png`, aliases: [], ...i,
    })),
  });
}

beforeEach(() => { delete process.env.CLIPART_PRESET_DIR; });

describe('presetDir', () => {
  it('defaults to the operator Codex skill directory', () => {
    expect(presetDir()).toBe(path.join(os.homedir(), '.codex', 'skills', 'character-clipart-library'));
  });

  it('is overridable so the worker machine can point elsewhere', () => {
    seed([]);
    expect(presetDir()).toBe(process.env.CLIPART_PRESET_DIR);
  });

  it('is read at call time, not at import time', () => {
    const a = seed([]);
    const b = seed([]);
    expect(a).not.toBe(b);
    expect(presetDir()).toBe(b);
  });
});

describe('loadPresetClipart', () => {
  it('turns catalog items into preset-owned entries', async () => {
    seed([{ keyword: '걱정', aliases: ['불안', '고민'], category: '감정' }]);
    expect(await loadPresetClipart()).toEqual([{
      id: 'preset:걱정', ownerId: '__preset__', keyword: '걱정',
      aliases: ['불안', '고민'], category: '감정', source: 'preset',
      file: 'assets/clipart/걱정.png',
    }]);
  });

  it('accepts a top-level array as well as { items }', async () => {
    seedRaw([{ keyword: '걱정', aliases: [], category: '감정', file: 'assets/clipart/걱정.png', status: 'ready' }]);
    expect((await loadPresetClipart()).map((e) => e.keyword)).toEqual(['걱정']);
  });

  it('skips items that are not ready', async () => {
    seed([{ keyword: '걱정' }, { keyword: '기쁨', status: 'pending' }]);
    expect((await loadPresetClipart()).map((e) => e.keyword)).toEqual(['걱정']);
  });

  it('returns an empty catalog when the directory is missing', async () => {
    process.env.CLIPART_PRESET_DIR = path.join(os.tmpdir(), 'nope-' + Date.now());
    expect(await loadPresetClipart()).toEqual([]);
  });

  it('returns an empty catalog when the json is broken instead of throwing', async () => {
    seedRaw('{ not json');
    expect(await loadPresetClipart()).toEqual([]);
  });

  it('survives a catalog of the wrong shape', async () => {
    seedRaw({ version: 1 });
    expect(await loadPresetClipart()).toEqual([]);
  });

  it('skips an item with no file to point at', async () => {
    seed([{ keyword: '걱정', file: '' }]);
    expect(await loadPresetClipart()).toEqual([]);
  });
});

/**
 * 아래는 이 파일의 존재 이유다. Task 1이 실측 카탈로그(ready 104건, term 540개)로 재 본
 * 결과 현실적인 피트니스 대본 14문장 중 12개가 오검출했다. 빠진 캐릭터는 아무도 눈치채지
 * 못하지만 스쿼트 설명에 붙은 비 오는 캐릭터는 수강생이 발행한 릴스에 박힌 버그로 보인다.
 * 비대칭이 크므로 정밀도 쪽으로 세게 기운다.
 */
describe('loadPresetClipart – 정밀도 방어', () => {
  it('drops a one-character alias', async () => {
    seed([{ keyword: '동의', aliases: ['예', '찬성'] }]);
    expect((await loadPresetClipart())[0].aliases).toEqual(['찬성']);
  });

  it('drops the whole entry when the keyword itself is one character', async () => {
    // 키워드가 한 글자면 남는 건 별칭뿐인데, 그 항목은 `preset:비`라는 id로 `비`가 아닌
    // 이름을 달고 다니게 된다. 애초에 넣지 않는다.
    seed([{ keyword: '비', aliases: ['우천', '장마'] }, { keyword: '걱정' }]);
    expect((await loadPresetClipart()).map((e) => e.keyword)).toEqual(['걱정']);
  });

  it('drops an empty alias so one bad row cannot swallow every scene', async () => {
    // `''`는 모든 문장에 "들어 있다". 최소 길이 규칙이 이것도 같이 막는다.
    seed([{ keyword: '운동', aliases: ['', '  ', '헬스'] }]);
    expect((await loadPresetClipart())[0].aliases).toEqual(['헬스']);
  });

  it('stops 비 from matching 준비 자세', async () => {
    seed([{ keyword: '비', aliases: ['우천'] }]);
    expect(matchClipart('준비 자세부터 잡아 볼게요', await loadPresetClipart())).toBeNull();
  });

  it('stops 예 from matching 예방', async () => {
    seed([{ keyword: '동의', aliases: ['예'] }]);
    expect(matchClipart('부상을 예방하는 방법입니다', await loadPresetClipart())).toBeNull();
  });

  it('stops 돈 from matching 돈다면', async () => {
    seed([{ keyword: '돈', aliases: ['금전'] }]);
    expect(matchClipart('고관절이 안쪽으로 돈다면 잘못된 겁니다', await loadPresetClipart())).toBeNull();
  });

  it('keeps a legitimate two-character match alive', async () => {
    // 정밀도를 올리다 정상 일치까지 죽이면 이 기능은 아무것도 못 한다.
    seed([{ keyword: '걱정', aliases: ['불안'] }]);
    expect(matchClipart('무릎 통증을 걱정하십니다', await loadPresetClipart())?.keyword).toBe('걱정');
  });
});

/**
 * 솎아 낸 별칭들. 실측이 드러낸 오검출의 원인이고, 되돌리면 그대로 재발한다.
 * 넷 다 별칭이라 항목(그림)은 다른 별칭으로 계속 닿을 수 있다.
 */
describe('loadPresetClipart – 솎아 낸 별칭', () => {
  it('drops 소식 from 뉴스 so a diet script is not the news', async () => {
    seed([{ keyword: '뉴스', aliases: ['소식', '보도', '기사'] }]);
    const catalog = await loadPresetClipart();
    expect(catalog[0].aliases).toEqual(['보도', '기사']);
    expect(matchClipart('소식하는 습관이 체중을 바꿉니다', catalog)).toBeNull();
    expect(matchClipart('오늘의 보도를 정리했습니다', catalog)?.keyword).toBe('뉴스');
  });

  it('drops 화제 from 바이럴 so 소화제 is not viral', async () => {
    seed([{ keyword: '바이럴', aliases: ['입소문', '화제'] }]);
    const catalog = await loadPresetClipart();
    expect(matchClipart('소화제에 의존하지 마세요', catalog)).toBeNull();
    expect(matchClipart('입소문이 퍼지고 있습니다', catalog)?.keyword).toBe('바이럴');
  });

  it('drops 기상 from 아침 so 기상청 is not morning', async () => {
    seed([{ keyword: '아침', aliases: ['기상', '아침 시간'] }]);
    const catalog = await loadPresetClipart();
    expect(matchClipart('기상청 예보를 확인하세요', catalog)).toBeNull();
    expect(matchClipart('아침 시간에 하시면 좋습니다', catalog)?.keyword).toBe('아침');
  });

  it('drops 지침 from 피곤 so an exercise guideline is not fatigue', async () => {
    seed([{ keyword: '피곤', aliases: ['피로', '지침'] }]);
    const catalog = await loadPresetClipart();
    expect(matchClipart('운동 지침에 따르면 주 3회입니다', catalog)).toBeNull();
    expect(matchClipart('피로가 쌓이면 이렇게 하세요', catalog)?.keyword).toBe('피곤');
  });

  it('never drops a curated word that is an entry keyword, only an alias', async () => {
    // 운영자가 나중에 `기상`을 키워드로 쓰는 항목을 만들 수 있다. 그때 항목이 통째로
    // 사라지면 원인을 찾기 어렵다. 솎아 내기는 별칭에만 건다.
    seed([{ keyword: '기상', aliases: ['아침'] }]);
    expect((await loadPresetClipart()).map((e) => e.keyword)).toEqual(['기상']);
  });
});

/**
 * 남는 오검출은 동음이의어다. 이건 못 고친다 — 그리고 고치려 들지 않는다.
 * 프리셋은 자기 캐릭터를 아직 안 올린 수강생의 대타일 뿐이고, 올린 수강생은 키워드를
 * 자기가 정하므로 자기 정밀도를 자기가 쥔다.
 */
describe('loadPresetClipart – 감수하는 잔여 오검출', () => {
  it('documents that 사과 (apology) still matches 사과 (apple)', async () => {
    seed([{ keyword: '사과', aliases: ['미안'] }]);
    expect(matchClipart('사과 한 개는 100칼로리입니다', await loadPresetClipart())?.keyword).toBe('사과');
  });
});
