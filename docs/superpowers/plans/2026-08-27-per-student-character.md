# 수강생별 캐릭터 — 구현 계획 (계획 2b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수강생이 강의에서 만든 자기 캐릭터를 업로드해 쓰고, 아직 안 만든 수강생에게는 운영자 캐릭터가 기본으로 나오되 그것이 기본값임을 앱 안에서 명확히 알린다.

**Architecture:** 클립아트를 수강생별로 소유하게 한다 — 목소리와 같은 구조다. 카탈로그는 `store`에, 이미지는 아티팩트 저장소에 둔다. 수강생이 등록한 것이 없으면 운영자 프리셋(Codex 클립아트 라이브러리 104장)으로 폴백한다. 워커가 씬 텍스트에 맞는 이미지만 렌더 publicDir로 복사한다 — 나레이션 오디오와 같은 경로 규약이다.

**Tech Stack:** Next.js 16 · React 19 · Remotion 4.0.517 · TypeScript · Vitest

**Spec:** `docs/superpowers/specs/2026-08-26-unified-video-studio-design.md`
**선행 계획:** `docs/superpowers/plans/2026-08-27-scene-variety.md` (계획 2a) — 씬 6종과 `SceneBase.characterImageUrl`이 여기서 나온다

## Global Constraints

- 세로 해상도는 **1080×1920**, fps **30** 고정
- 색 리터럴이 허용되는 파일은 `packages/video/src/types.ts` 하나뿐이다. 가드 테스트가 강제한다
- 저장소 접근은 항상 `store` 인터페이스를 통한다. 프로덕션 코드는 `fileStore`를 직접 import하지 않는다
- **캐릭터는 소유자가 하나다.** 수강생 A가 B의 캐릭터를 보거나 쓸 수 없다 — 목소리와 같은 경계다
- 커밋 전 `npx vitest run` · `npx tsc --noEmit` · `npx next build`가 모두 깨끗해야 한다
- 커밋은 각 Task 끝에서 한 번씩 한다
- 한국어 UI 문구를 유지한다
- **Remotion에 넘기는 미디어 경로는 public 루트 기준 상대 경로다.** 절대 파일시스템 경로는 렌더러가 받지 못한다

## 결정과 근거

**운영자 캐릭터를 기본값으로 쓴다.** 캐릭터가 아예 없으면 수강생이 이 기능의 존재를 모른다. 남의 캐릭터가 보여야 "이건 내가 아닌데" 하고 바꾼다.

**단, 그 인지는 앱 안에서 일어나야 한다.** 수강생이 모른 채 발행하면 시청자가 먼저 알아챈다 — 목소리에서 고친 문제의 시각판이 된다. 그래서 Task 6이 출력 카드에 기본값 안내를 붙인다. 이건 장식이 아니라 이 결정을 성립시키는 조건이다.

**사이트 내 캐릭터 생성은 하지 않는다.** 수강생은 강의에서 만들고 업로드한다. 이유가 셋이다 — 강의 내용 자체가 되고, 운영자 원가가 0이고, **수강생이 실제로 몇 장을 쓰는지 알기 전에 생성기를 만들지 않게 된다.** 앱이 힉스필드를 직접 부르려면 REST API가 필요한데 그건 스펙 R-6로 아직 미검증이다.

---

## File Structure

**신규**

| 경로 | 책임 |
|---|---|
| `lib/clipart-store.ts` | 수강생별 카탈로그 CRUD (`store` 기반) |
| `lib/clipart-preset.ts` | 운영자 프리셋 로드 (Codex 라이브러리) |
| `lib/clipart.ts` | 키워드 매칭 · 에셋 키 |
| `app/api/clipart/route.ts` | 업로드(POST) · 목록(GET) |
| `packages/video/src/components/CharacterImage.tsx` | 씬 위 캐릭터 오버레이 |

**수정**

| 경로 | 변경 |
|---|---|
| `packages/video/src/scenes/SceneRouter.tsx` | `characterImageUrl`이 있으면 오버레이 |
| `lib/pipeline/scenes.ts` | 씬에 캐릭터를 붙이고 `usedClipart`를 반환 |
| `lib/engines/remotion.ts` | 카탈로그 조회 · 클립아트 복사 연결 |
| `worker/render.ts` | `copyClipart` |
| `app/page.tsx` | 기본 캐릭터 안내 + 업로드 입력 |

---

## Task 1: 클립아트 모델과 매칭

**Files:**
- Create: `lib/clipart.ts`
- Test: `lib/__tests__/clipart.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `ClipartEntry { id: string; ownerId: string; keyword: string; aliases: string[]; category: string; source: 'preset' | 'student'; file: string }` — `source`가 `preset`이면 `file`은 프리셋 디렉터리 기준 상대 경로, `student`면 아티팩트 키
  - `matchClipart(text: string, catalog: ClipartEntry[]): ClipartEntry | null` — 가장 긴 일치 우선
  - `clipartAssetKey(entry: ClipartEntry): string` — `clipart/<10자 hex>.png`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/clipart.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { matchClipart, clipartAssetKey, type ClipartEntry } from '../clipart';

const entry = (keyword: string, aliases: string[], file: string): ClipartEntry => ({
  id: `c-${keyword}`, ownerId: 'u1', keyword, aliases,
  category: '감정', source: 'preset', file,
});

const catalog = [
  entry('걱정', ['불안', '고민', 'worried'], 'assets/clipart/걱정.png'),
  entry('건강', ['건강하다', '컨디션'], 'assets/clipart/건강.png'),
  entry('운동', ['헬스'], 'assets/clipart/운동.png'),
];

describe('matchClipart', () => {
  it('matches on the keyword itself', () => {
    expect(matchClipart('무릎 통증을 걱정하십니다', catalog)?.keyword).toBe('걱정');
  });

  it('matches on an alias', () => {
    expect(matchClipart('많이 불안하시죠', catalog)?.keyword).toBe('걱정');
  });

  it('returns null when nothing matches', () => {
    expect(matchClipart('발바닥을 바닥에 누르세요', catalog)).toBeNull();
  });

  // 짧은 단어가 긴 단어 안에 우연히 들어가는 일이 잦다. 긴 일치가 이겨야 한다.
  it('prefers the longest match', () => {
    expect(matchClipart('건강하다고 느끼세요', catalog)?.keyword).toBe('건강');
  });

  it('is not confused by an empty string', () => {
    expect(matchClipart('', catalog)).toBeNull();
  });

  it('returns null for an empty catalog', () => {
    expect(matchClipart('걱정됩니다', [])).toBeNull();
  });
});

describe('clipartAssetKey', () => {
  it('produces an ascii-safe public path', () => {
    expect(clipartAssetKey(catalog[0])).toMatch(/^clipart\/[0-9a-f]{10}\.png$/);
  });

  it('is stable for the same entry', () => {
    expect(clipartAssetKey(catalog[0])).toBe(clipartAssetKey(catalog[0]));
  });

  it('differs between entries', () => {
    expect(clipartAssetKey(catalog[0])).not.toBe(clipartAssetKey(catalog[1]));
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/clipart.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`lib/clipart.ts`:

```ts
import { createHash } from 'node:crypto';

export interface ClipartEntry {
  id: string;
  ownerId: string;
  keyword: string;
  aliases: string[];
  category: string;
  /** preset이면 file은 프리셋 디렉터리 기준 상대 경로, student면 아티팩트 키 */
  source: 'preset' | 'student';
  file: string;
}

/**
 * 캐릭터가 없어도 릴스는 나와야 한다. 매칭 실패는 오류가 아니라 "이 씬엔 캐릭터 없음"이다.
 * 긴 일치를 우선하는 이유: 짧은 단어가 다른 단어 안에 우연히 포함되는 일이 잦다.
 */
export function matchClipart(text: string, catalog: ClipartEntry[]): ClipartEntry | null {
  if (!text.trim()) return null;

  let best: ClipartEntry | null = null;
  let bestLength = 0;

  for (const entry of catalog) {
    for (const term of [entry.keyword, ...entry.aliases]) {
      if (term.length > bestLength && text.includes(term)) {
        best = entry;
        bestLength = term.length;
      }
    }
  }
  return best;
}

/**
 * 파일명이 한국어라 URL 인코딩 문제를 낳을 수 있다. 이 저장소는 미디어 경로 때문에
 * 이미 한 번 크게 데었으므로(오디오가 렌더러에 닿지 못한 건) ASCII로 고정한다.
 */
export function clipartAssetKey(entry: ClipartEntry): string {
  return `clipart/${createHash('sha1').update(entry.id).digest('hex').slice(0, 10)}.png`;
}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run lib/__tests__/clipart.test.ts
npx tsc --noEmit
```

기대: 9개 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/clipart.ts lib/__tests__/clipart.test.ts
git commit -m "feat: model clipart entries and match them to script text"
```

---

## Task 2: 수강생 카탈로그와 운영자 프리셋

**Files:**
- Create: `lib/clipart-store.ts`, `lib/clipart-preset.ts`
- Test: `lib/__tests__/clipart-store.test.ts`

**Interfaces:**
- Consumes: `ClipartEntry` (Task 1), `store` (`lib/store`)
- Produces:
  - `listStudentClipart(ownerId: string): Promise<ClipartEntry[]>`
  - `addStudentClipart(entry: Omit<ClipartEntry, 'id' | 'source'>): Promise<ClipartEntry>`
  - `presetDir(): string` — `CLIPART_PRESET_DIR`, 기본값 `~/.codex/skills/character-clipart-library`
  - `loadPresetClipart(): Promise<ClipartEntry[]>` — 없거나 깨졌으면 `[]`
  - `catalogFor(ownerId: string): Promise<{ entries: ClipartEntry[]; usingPreset: boolean }>` — 수강생 것이 하나라도 있으면 그것만, 없으면 프리셋

`usingPreset`은 UI가 "기본 캐릭터입니다" 안내를 띄우는 근거다. 이 값이 없으면 수강생이 남의 캐릭터를 쓰고 있다는 걸 화면에서 알 방법이 없다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/clipart-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addStudentClipart, listStudentClipart, catalogFor } from '../clipart-store';

function seedPreset(entries: { keyword: string; aliases: string[] }[]) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'clipart-preset-'));
  mkdirSync(path.join(dir, 'assets', 'clipart'), { recursive: true });
  writeFileSync(path.join(dir, 'assets', 'catalog.json'), JSON.stringify({
    items: entries.map((e) => ({
      keyword: e.keyword, aliases: e.aliases, category: '감정',
      file: `assets/clipart/${e.keyword}.png`, status: 'ready',
    })),
  }));
  process.env.CLIPART_PRESET_DIR = dir;
}

beforeEach(() => seedPreset([{ keyword: '걱정', aliases: ['불안'] }]));

describe('listStudentClipart', () => {
  it('starts empty for a new student', async () => {
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  it('returns only the caller ownclipart', async () => {
    await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    await addStudentClipart({ ownerId: 'u2', keyword: '슬픔', aliases: [], category: '감정', file: 'clipart/b.png' });
    const mine = await listStudentClipart('u1');
    expect(mine.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  it('marks stored entries as student source', async () => {
    const saved = await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    expect(saved.source).toBe('student');
    expect(saved.id).toBeTruthy();
  });
});

describe('catalogFor', () => {
  it('falls back to the operator preset when the student has none', async () => {
    const { entries, usingPreset } = await catalogFor('u1');
    expect(usingPreset).toBe(true);
    expect(entries.map((e) => e.keyword)).toContain('걱정');
    expect(entries.every((e) => e.source === 'preset')).toBe(true);
  });

  // 자기 것이 하나라도 있으면 프리셋을 섞지 않는다. 섞으면 자기 캐릭터와 남의 캐릭터가
  // 한 영상에 같이 나온다.
  it('uses only the student clipart once they have any', async () => {
    await addStudentClipart({ ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
    const { entries, usingPreset } = await catalogFor('u1');
    expect(usingPreset).toBe(false);
    expect(entries.map((e) => e.keyword)).toEqual(['기쁨']);
  });

  it('reports an empty catalog when there is no preset either', async () => {
    process.env.CLIPART_PRESET_DIR = path.join(os.tmpdir(), 'does-not-exist-' + Date.now());
    const { entries, usingPreset } = await catalogFor('u1');
    expect(entries).toEqual([]);
    expect(usingPreset).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/clipart-store.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 프리셋 로더 구현**

`lib/clipart-preset.ts`. 실측 카탈로그 구조는 `{ items: [{ keyword, aliases, category, file, status }] }`이며 최상위가 배열일 수도 있다. `status`가 `ready`인 것만 쓴다.

```ts
export function presetDir(): string {
  return process.env.CLIPART_PRESET_DIR
    ?? path.join(os.homedir(), '.codex', 'skills', 'character-clipart-library');
}
```

`loadPresetClipart()`는 `assets/catalog.json`을 읽어 `ClipartEntry`로 변환한다. `ownerId`는 `'__preset__'`, `source`는 `'preset'`, `id`는 `preset:<keyword>`.

> **프리셋은 워커가 있는 기계에서만 읽힌다.** 이미지가 Codex 스킬 디렉터리에 있기 때문이다.
> 워커가 다른 기계로 옮겨가면 프리셋을 복사하거나 아티팩트 저장소로 올려야 한다.

- [ ] **Step 4: 수강생 카탈로그 구현**

`lib/clipart-store.ts`는 `store` 키 `clipart-library`를 쓴다. `lib/fish-voice-store.ts`가 같은 패턴이니 먼저 읽고 맞춘다.

- [ ] **Step 5: 통과 확인**

```bash
npx vitest run lib/__tests__/clipart-store.test.ts
npx tsc --noEmit
```

기대: 6개 PASS

- [ ] **Step 6: 실제 프리셋으로 확인**

```bash
npx tsx -e "
import { loadPresetClipart } from './lib/clipart-preset';
import { matchClipart } from './lib/clipart';
const c = await loadPresetClipart();
console.log('프리셋', c.length, '건');
for (const t of ['무릎 통증을 걱정하십니다','건강하게 운동하세요','발바닥을 누르세요'])
  console.log(' ', t, '→', matchClipart(t, c)?.keyword ?? '없음');
"
```

기대: 100건 이상 로드, 앞 두 문장 매칭, 마지막은 `없음`. 0건이면 `CLIPART_PRESET_DIR`을 확인하고 **보고한다** — 경로가 다르면 이후 Task가 전부 캐릭터 없이 돈다.

- [ ] **Step 7: 커밋**

```bash
git add lib/clipart-store.ts lib/clipart-preset.ts lib/__tests__/clipart-store.test.ts
git commit -m "feat: give each student their own clipart, falling back to the operator preset"
```

---

## Task 3: 업로드 라우트

목소리(`app/api/voicebox/clone`)와 같은 경계다. 그 파일을 먼저 읽고 세션·소유권 처리를 맞춘다.

**Files:**
- Create: `app/api/clipart/route.ts`
- Test: `app/api/__tests__/clipart-route.test.ts`

**Interfaces:**
- Consumes: `addStudentClipart`·`catalogFor` (Task 2), `readSessionFromRequest` (`lib/auth`), `selectArtifactStore` (`lib/store`)
- Produces:
  - `POST /api/clipart` — multipart `image`·`keyword`·`aliases`(쉼표 구분)·`category`. 401 미인증, 400 입력 오류
  - `GET /api/clipart` — 200 `{ entries, usingPreset }`, 401 미인증

- [ ] **Step 1: 실패하는 테스트 작성**

`app/api/__tests__/clipart-route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GET, POST } from '../clipart/route';
import { signSession } from '@/lib/auth';

beforeEach(() => { process.env.SESSION_SECRET = 'test-secret'; });

function req(method: string, ownerId?: string, body?: BodyInit) {
  return new Request('http://localhost/api/clipart', {
    method,
    headers: ownerId ? { Cookie: `student_session=${signSession(ownerId)}` } : {},
    body,
  });
}

function form(keyword: string) {
  const fd = new FormData();
  fd.append('image', new Blob(['PNGDATA'], { type: 'image/png' }), 'c.png');
  fd.append('keyword', keyword);
  fd.append('aliases', '별칭1,별칭2');
  fd.append('category', '감정');
  return fd;
}

describe('GET /api/clipart', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await GET(req('GET'))).status).toBe(401);
  });

  it('reports the preset fallback for a new student', async () => {
    const body = await (await GET(req('GET', 'u1'))).json();
    expect(body.usingPreset).toBe(true);
  });
});

describe('POST /api/clipart', () => {
  it('rejects an unauthenticated upload', async () => {
    expect((await POST(req('POST', undefined, form('기쁨')))).status).toBe(401);
  });

  it('rejects an upload with no keyword', async () => {
    const fd = form('');
    expect((await POST(req('POST', 'u1', fd))).status).toBe(400);
  });

  it('stores an upload against the caller', async () => {
    expect((await POST(req('POST', 'u1', form('기쁨')))).status).toBe(200);
    const body = await (await GET(req('GET', 'u1'))).json();
    expect(body.usingPreset).toBe(false);
    expect(body.entries.map((e: { keyword: string }) => e.keyword)).toEqual(['기쁨']);
  });

  // 업로드한 뒤에도 다른 수강생 목록은 그대로여야 한다.
  it('does not leak an upload into another student catalog', async () => {
    await POST(req('POST', 'u1', form('기쁨')));
    const other = await (await GET(req('GET', 'u2'))).json();
    expect(other.usingPreset).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run app/api/__tests__/clipart-route.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

업로드된 이미지는 아티팩트 저장소에 올린다. 저장 키는 `clipartAssetKey`가 정한다 — 엔트리를 먼저 만들어 `id`를 확보한 뒤 그 키로 올린다. 세션은 `readSessionFromRequest`로 읽는다(`app/api/projects/route.ts`가 같은 방식).

`image`가 없거나 `image/png`·`image/jpeg`가 아니면 400. `keyword`가 비면 400. `aliases`는 쉼표로 나누고 빈 항목을 버린다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

기대: 6개 PASS + 전체 통과

- [ ] **Step 5: 커밋**

```bash
git add app/api/clipart lib/__tests__ app/api/__tests__
git commit -m "feat: let a student upload their own character clipart"
```

---

## Task 4: 캐릭터 오버레이 컴포넌트

**Files:**
- Create: `packages/video/src/components/CharacterImage.tsx`
- Modify: `packages/video/src/scenes/SceneRouter.tsx`
- Test: `packages/video/src/__tests__/characterImage.test.ts`

**Interfaces:**
- Consumes: `SceneBase.characterImageUrl` (계획 2a Task 1), `resolveAudioSrc` (`utils/audioSrc`)
- Produces:
  - `characterEntry(sceneFrame: number, fps: number): { opacity: number; translateY: number }`
  - `<CharacterImage src={string} />`
  - `SceneRouter`가 `characterImageUrl`이 있으면 씬 위에 오버레이

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/video/src/__tests__/characterImage.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { characterEntry } from '../components/CharacterImage';

describe('characterEntry', () => {
  it('starts invisible and below its resting place', () => {
    const at0 = characterEntry(0, 30);
    expect(at0.opacity).toBe(0);
    expect(at0.translateY).toBeGreaterThan(0);
  });

  it('settles fully visible at rest', () => {
    const settled = characterEntry(30, 30);
    expect(settled.opacity).toBe(1);
    expect(settled.translateY).toBe(0);
  });

  it('never overshoots opacity', () => {
    for (const f of [0, 5, 10, 20, 45, 200]) {
      const v = characterEntry(f, 30);
      expect(v.opacity).toBeGreaterThanOrEqual(0);
      expect(v.opacity).toBeLessThanOrEqual(1);
    }
  });

  it('does not throw for a negative frame', () => {
    expect(() => characterEntry(-5, 30)).not.toThrow();
  });

  // fps가 낮아도 보간 구간이 무너지면 안 된다 — 계획 1에서 같은 실수를 한 적이 있다.
  it('does not throw for a very low fps', () => {
    expect(() => characterEntry(0, 1)).not.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run packages/video/src/__tests__/characterImage.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

```tsx
import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { resolveAudioSrc } from '../utils/audioSrc';

/** 프레임 0에서 아래에 투명하게 있다가 0.5초에 걸쳐 제자리로 올라온다. */
export function characterEntry(sceneFrame: number, fps: number) {
  const settle = Math.max(1, Math.round(fps * 0.5));
  const opts = { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' } as const;
  return {
    opacity: interpolate(sceneFrame, [0, settle], [0, 1], opts),
    translateY: interpolate(sceneFrame, [0, settle], [48, 0], opts),
  };
}

/**
 * `src`는 public 루트 기준 상대 경로다. `resolveAudioSrc`는 이름과 달리 오디오 전용이 아니라
 * "원격 URL이면 그대로, 상대 경로면 staticFile()" 규칙이라 이미지에도 그대로 필요하다.
 */
export const CharacterImage: React.FC<{ src: string }> = ({ src }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { opacity, translateY } = characterEntry(frame, fps);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 300 }}>
      <Img
        src={resolveAudioSrc(src)}
        style={{ width: 620, objectFit: 'contain', opacity, transform: `translateY(${translateY}px)` }}
      />
    </AbsoluteFill>
  );
};
```

`SceneRouter`에서 씬 뒤에 얹는다:

```tsx
      {renderScene(active, palette)}
      {active.characterImageUrl && <CharacterImage src={active.characterImageUrl} />}
```

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
```

기대: 5개 PASS + 전체 통과 (색 가드 포함)

- [ ] **Step 5: 커밋**

```bash
git add packages/video/src/components/CharacterImage.tsx packages/video/src/scenes/SceneRouter.tsx packages/video/src/__tests__/characterImage.test.ts
git commit -m "feat: overlay a character on the active scene"
```

---

## Task 5: 파이프라인 연결

**Files:**
- Modify: `lib/pipeline/scenes.ts`, `lib/engines/remotion.ts`, `worker/render.ts`
- Test: `lib/__tests__/scenes.test.ts` (수정), `worker/__tests__/clipart-copy.test.ts` (신규)

**Interfaces:**
- Consumes: `catalogFor` (Task 2), `matchClipart`·`clipartAssetKey` (Task 1), `presetDir` (Task 2)
- Produces:
  - `buildScenes(input: { subtitles; script; sheet; catalog: ClipartEntry[] }): { scenes: SceneDirective[]; usedClipart: ClipartEntry[] }`
  - `copyClipart(entries: ClipartEntry[], publicDir: string): Promise<void>`

**반환 타입이 바뀐다** — 워커가 어떤 이미지를 복사할지 알아야 한다. 계획 2a에서 `buildScenes`는 배열을 돌려줬으므로 호출부를 함께 고친다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/scenes.test.ts`에 추가:

```ts
const catalog = [{
  id: 'c1', ownerId: 'u1', keyword: '걱정', aliases: ['불안'],
  category: '감정', source: 'preset' as const, file: 'assets/clipart/걱정.png',
}];

it('attaches a character when the text matches', () => {
  const s = subs('제목', '많이 걱정하시죠 무릎 통증 때문에', '끝');
  const { scenes, usedClipart } = buildScenes({ subtitles: s, script: '대본', sheet, catalog });
  expect(scenes[1].characterImageUrl).toMatch(/^clipart\//);
  expect(usedClipart.map((c) => c.keyword)).toEqual(['걱정']);
});

it('leaves a scene without a character when nothing matches', () => {
  const s = subs('제목', '발바닥을 바닥에 고르게 누르세요 천천히', '끝');
  const { scenes, usedClipart } = buildScenes({ subtitles: s, script: '대본', sheet, catalog });
  expect(scenes[1].characterImageUrl).toBeUndefined();
  expect(usedClipart).toEqual([]);
});

it('reports a repeated clipart only once', () => {
  const s = subs('제목', '걱정이 됩니다 정말 많이', '걱정하지 마세요 괜찮습니다', '끝');
  expect(buildScenes({ subtitles: s, script: '대본', sheet, catalog }).usedClipart).toHaveLength(1);
});
```

`worker/__tests__/clipart-copy.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copyClipart } from '../render';
import { clipartAssetKey, type ClipartEntry } from '@/lib/clipart';

let publicDir: string;
const entry: ClipartEntry = {
  id: 'c1', ownerId: 'u1', keyword: '걱정', aliases: [],
  category: '감정', source: 'preset', file: 'assets/clipart/걱정.png',
};

beforeEach(() => {
  const source = mkdtempSync(path.join(os.tmpdir(), 'clipart-src-'));
  mkdirSync(path.join(source, 'assets', 'clipart'), { recursive: true });
  writeFileSync(path.join(source, entry.file), 'PNGDATA');
  process.env.CLIPART_PRESET_DIR = source;
  publicDir = mkdtempSync(path.join(os.tmpdir(), 'clipart-pub-'));
});

describe('copyClipart', () => {
  it('copies a preset image under its ascii-safe key', async () => {
    await copyClipart([entry], publicDir);
    expect(existsSync(path.join(publicDir, clipartAssetKey(entry)))).toBe(true);
  });

  it('does nothing for an empty list', async () => {
    await expect(copyClipart([], publicDir)).resolves.toBeUndefined();
  });

  // 캐릭터가 없다고 렌더 전체가 죽으면 안 된다.
  it('skips a missing source instead of throwing', async () => {
    await expect(copyClipart([{ ...entry, file: 'assets/clipart/없음.png' }], publicDir))
      .resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/scenes.test.ts worker/__tests__/clipart-copy.test.ts
```

기대: FAIL

- [ ] **Step 3: 씬 조립에 캐릭터 붙이기**

`buildScenes`가 세그먼트마다 `matchClipart`를 부르고, 맞으면 `characterImageUrl: clipartAssetKey(entry)`를 넣는다. 쓰인 엔트리는 `Map`으로 중복을 없애 `usedClipart`로 돌려준다.

- [ ] **Step 4: `copyClipart` 구현**

`worker/render.ts`에 추가한다. `source`에 따라 원본 위치가 다르다:

```ts
/**
 * 매칭된 클립아트만 렌더 publicDir로 옮긴다. 프리셋 라이브러리는 118MB라 저장소에 넣지 않는다.
 * 원본이 없으면 조용히 건너뛴다 — 캐릭터가 빠지는 것과 릴스가 안 나오는 것은 무게가 다르다.
 */
export async function copyClipart(entries: ClipartEntry[], publicDir: string): Promise<void> {
  for (const entry of entries) {
    const target = path.join(publicDir, clipartAssetKey(entry));
    try {
      await mkdir(path.dirname(target), { recursive: true });
      if (entry.source === 'preset') {
        await copyFile(path.join(presetDir(), entry.file), target);
      } else {
        await fetchArtifactInto(entry.file, target);
      }
    } catch {
      // 원본 없음 — 이 씬은 캐릭터 없이 렌더된다
    }
  }
}
```

`fetchArtifactInto`는 아티팩트 저장소에서 파일을 내려받아 저장한다. 로컬 구현은 복사, Blob 구현은 URL fetch다. `lib/store/index.ts`의 아티팩트 저장소 인터페이스에 읽기 메서드가 없다면 이 Task에서 추가한다.

- [ ] **Step 5: 엔진에 연결**

`lib/engines/remotion.ts`:

```ts
    onProgress(55);
    const sheet = await getStyleSheet(input.ownerId);
    const { entries } = await catalogFor(input.ownerId);
    const { scenes, usedClipart } = await generateScenes({
      script: input.script, subtitles, sheet, catalog: entries,
    });
    await copyClipart(usedClipart, appPublicDir());
```

- [ ] **Step 6: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

기대: 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add lib/pipeline/scenes.ts lib/engines/remotion.ts worker/render.ts lib/__tests__ worker/__tests__
git commit -m "feat: match a character per scene and hand it to the renderer"
```

---

## Task 6: 기본 캐릭터임을 앱에서 알린다

이 Task가 "운영자 캐릭터를 기본값으로 쓴다"는 결정을 성립시킨다. 안내가 없으면 수강생이 남의 캐릭터로 발행하고 시청자가 먼저 알아챈다.

**Files:**
- Modify: `app/page.tsx`, `app/globals.css`
- Test: 없음 (UI 안내 — 눈으로 확인)

**Interfaces:**
- Consumes: `GET /api/clipart` (Task 3)

- [ ] **Step 1: 상태 조회**

`app/page.tsx`가 마운트 시 `GET /api/clipart`를 불러 `usingPreset`을 상태에 담는다. 기존 `/api/voicebox/profiles` 로딩 `useEffect`가 같은 모양이니 그 옆에 둔다.

- [ ] **Step 2: 안내 띄우기**

`usingPreset`이 참이면 준비 상태 영역에 눈에 띄게 표시한다:

```tsx
{usingPreset && (
  <div className="presetCharacterNotice">
    <strong>기본 캐릭터로 만들어집니다</strong>
    <p>강의에서 만든 내 캐릭터를 올리면 내 얼굴로 바뀝니다.</p>
    <input type="file" accept="image/png,image/jpeg" onChange={uploadClipart} />
  </div>
);
```

**색은 기존 토큰만 쓴다** (`--panel`, `--ink`, `--muted`, `--acid`, `--line`, `--pink`). `app/globals.css`는 색 가드 테스트 범위 밖이라 사람이 지켜야 한다.

`uploadClipart`는 `POST /api/clipart`에 `image`·`keyword`·`aliases`·`category`를 multipart로 보낸다. 키워드는 파일명에서 확장자를 뗀 값을 기본으로 채우고 수정 가능하게 한다.

- [ ] **Step 3: 눈으로 확인**

```bash
npm run dev
```

`/login`에서 `TEST01`로 들어가 확인한다:
- 캐릭터를 올리기 전 → 안내가 보인다
- 하나 올린 뒤 → 안내가 사라지고 목록에 뜬다
- 스크린샷을 `/tmp/preset-notice.png`에 저장한다

- [ ] **Step 4: 커밋**

```bash
git add app/page.tsx app/globals.css
git commit -m "feat: tell a student when the default character is in use"
```

---

## Task 7: 끝까지 실행 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 앱과 워커 기동**

```bash
npm run dev
```

```bash
set -a && . ./.env.local && set +a
WORKER_RUN=1 APP_URL=http://localhost:3000 npx tsx worker/index.ts
```

- [ ] **Step 2: 프리셋 상태로 한 편**

`TEST01`로 로그인해 아래 대본으로 생성한다. `걱정`·`건강`·`운동`이 프리셋에 있으므로 캐릭터가 붙어야 한다.

```
무릎 통증 잡는 법을 알려드릴게요.
많은 분들이 무릎 때문에 걱정하십니다.
발바닥 고르게, 무릎 방향 정렬, 천천히 내려가기.
이게 핵심입니다.
꾸준히 하시면 건강하게 운동할 수 있습니다.
```

- [ ] **Step 3: 캐릭터를 올린 뒤 한 편 더**

아무 PNG나 키워드 `걱정`으로 올린 다음 같은 대본으로 다시 만든다.

- [ ] **Step 4: 두 결과를 비교**

```bash
for f in <프리셋.mp4> <내캐릭터.mp4>; do
  ffprobe -v error -show_entries stream=codec_type,width,height -of default=noprint_wrappers=1 "$f"
  ffmpeg -v error -ss 4 -i "$f" -frames:v 1 -y "/tmp/$(basename "$f" .mp4)-frame.png"
done
```

확인할 것:
- 두 영상 모두 1080×1920, 오디오 있음
- **`걱정` 구간의 캐릭터가 서로 다름** — 하나는 운영자 프리셋, 하나는 올린 이미지
- 매칭이 안 되는 구간엔 캐릭터가 없음

캐릭터가 양쪽 다 같거나 아예 없으면 **보고하고 멈춘다.** 소유권 분리나 복사 경로가 끊겼다는 뜻이고, 다음 단계로 넘어가면 원인이 묻힌다.
