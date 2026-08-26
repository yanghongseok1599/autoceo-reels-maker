# 수강생이 쓸 수 있는 릴스 스튜디오 — 구현 계획 (1단계 / 계획 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수강생이 초대코드로 접속해 대본을 입력하면 9:16 세로 릴스 MP4가 생성되어 다운로드되는 서비스를 만든다.

**Architecture:** Vercel의 Next.js 앱이 잡을 큐에 넣고, 맥에서 상시 실행되는 렌더 워커가 그 큐를 폴링해 Remotion으로 렌더한 뒤 결과를 되돌려준다. 워커가 앱을 호출하는 방향이므로 맥에 인바운드 포트를 열 필요가 없다. 생성 엔진은 인터페이스 뒤에 두어 3단계의 Higgsfield가 어댑터 추가만으로 붙게 한다.

**Tech Stack:** Next.js 16 (App Router) · React 19 · Remotion 4 · TypeScript · Vitest · Fish Audio TTS · whisper.cpp (로컬 STT) · Vercel Blob

**Spec:** `docs/superpowers/specs/2026-08-26-unified-video-studio-design.md`

## Global Constraints

- 세로 해상도는 **1080×1920**, fps **30** 고정
- 씬 컴포넌트는 계획 1에서 **`title_card` 1종만** 구현한다. 나머지 5종과 Rive는 계획 2
- 색상을 컴포넌트에 하드코딩하지 않는다. **항상 `StyleSheet.palette`에서 온다**
- 배경 이미지는 **온보딩에서 생성한 라이브러리에서 재사용**한다. 씬마다 새로 생성하지 않는다 (편당 12 크레딧 → 월 6,000 크레딧)
- 저장소 접근은 항상 인터페이스를 통한다. 파일 구현체를 직접 import하지 않는다
- 워커 인증 토큰 `WORKER_TOKEN`은 서버 환경변수와 워커에만 존재한다. `NEXT_PUBLIC_` 접두사 금지
- 모든 외부 API 키는 서버사이드 전용. 클라이언트 번들 반입 금지
- 한국어 UI 문구를 유지한다 (기존 `app/page.tsx` 톤)
- 커밋은 각 Task 끝에서 한 번씩 한다
- **커밋 전 `npx tsc --noEmit`이 깨끗해야 한다.** 타입 오류를 남기고 다음 Task로 넘어가지 않는다

---

## File Structure

**신규 생성**

| 경로 | 책임 |
|---|---|
| `packages/video/src/index.ts` | Remotion 엔트리 |
| `packages/video/src/Root.tsx` | 컴포지션 등록 (`ReelVertical`) |
| `packages/video/src/ReelVertical.tsx` | 세로 릴스 조립 |
| `packages/video/src/scenes/TitleCard.tsx` | 타이틀 씬 (세로) |
| `packages/video/src/scenes/SceneRouter.tsx` | 씬 타입 → 컴포넌트 분기 |
| `packages/video/src/components/Subtitles.tsx` | 단어 단위 자막 |
| `packages/video/src/utils/animations.ts` | 스프링/입퇴장 헬퍼 |
| `packages/video/src/utils/voiceAnalysis.ts` | 단어 타이밍 → 에너지 |
| `packages/video/src/types.ts` | 씬·자막 타입 |
| `lib/store/types.ts` | 저장소 인터페이스 |
| `lib/store/file-store.ts` | 파일 기반 구현체 |
| `lib/store/blob-store.ts` | Vercel Blob 구현체 (배포용) |
| `lib/store/index.ts` | 환경에 따른 구현체 선택 |
| `lib/jobs.ts` | RenderJob 큐 로직 |
| `lib/auth.ts` | 초대코드 세션 |
| `lib/engines/types.ts` | VideoEngine 인터페이스 |
| `lib/engines/remotion.ts` | Remotion 어댑터 |
| `lib/pipeline/tts.ts` | Fish Audio 래퍼 |
| `lib/pipeline/stt.ts` | whisper 호출 |
| `lib/style-sheet.ts` | 스타일 프리셋 · 팔레트 · 배경 라이브러리 |
| `lib/pipeline/scenes.ts` | 씬 지시서 생성 + 폴백 |
| `app/api/jobs/next/route.ts` | 워커 잡 배출 |
| `app/api/jobs/[id]/route.ts` | 진행률·결과 수신 |
| `app/api/auth/route.ts` | 초대코드 검증 |
| `worker/index.ts` | 렌더 워커 루프 |

**수정**

| 경로 | 변경 |
|---|---|
| `package.json` | workspaces 추가, vitest, 스크립트 |
| `app/api/video/generate/route.ts` | HeyGen 분기 제거, 잡 큐로 전환 |
| `app/page.tsx` | 생성 흐름을 새 API에 연결 |
| `lib/learning-store.ts` | 표본 문턱 도입 |

**삭제**

`lib/voicebox-client.ts` · `app/reels/` · `app/api/avatar/create/route.ts` · `app/api/voice/clone/route.ts` · `lib/mock-jobs.ts`

---

## Task 1: Remotion 렌더 가능성 검증 (R-1)

스펙의 최대 위험이다. `youtube-voice-long-main`은 `node_modules`가 없고 커밋이 하나뿐이라 한 번도 실행된 적이 없을 가능성이 높다. **여기서 렌더가 안 나오면 이후 모든 이식 작업의 전제가 무너지므로 가장 먼저 확인한다.**

**Files:**
- 이 저장소는 수정하지 않는다. `/Users/seok/youtube/youtube-voice-long-main`에서만 작업

**Interfaces:**
- Consumes: 없음
- Produces: 렌더 성공 여부 (go/no-go). 성공 시 Remotion 4가 이 환경에서 동작함이 확인된다

- [ ] **Step 1: 의존성 설치**

```bash
cd /Users/seok/youtube/youtube-voice-long-main
npm install
```

- [ ] **Step 2: 기본 컴포지션 렌더**

```bash
cd /Users/seok/youtube/youtube-voice-long-main/packages/remotion-video
npx remotion render src/index.ts YouTubeVideo /tmp/verify.mp4 --frames=0-59
```

기대: 60프레임(2초) MP4가 생성된다. 기본 `defaultProps`에 자막 1개가 들어 있으므로 오디오 없이도 렌더된다.

- [ ] **Step 3: 결과 확인**

```bash
ls -la /tmp/verify.mp4 && ffprobe -v error -show_entries stream=width,height,duration -of default=noprint_wrappers=1 /tmp/verify.mp4
```

기대: `width=1920`, `height=1080`, 재생시간 약 2초.

- [ ] **Step 4: 결과를 스펙에 기록**

`docs/superpowers/specs/2026-08-26-unified-video-studio-design.md`의 R-1 행 상태를 `미검증` → `검증 완료 (2026-XX-XX)` 또는 실패 사유로 갱신한다.

**실패한 경우 여기서 멈추고 보고한다.** 원인이 Remotion 설치 문제인지, 코드 자체의 결함인지에 따라 이후 계획이 달라진다.

- [ ] **Step 5: 커밋**

```bash
cd "/Users/seok/youtube/Reels maker"
git add docs/superpowers/specs/2026-08-26-unified-video-studio-design.md
git commit -m "docs: record R-1 remotion render verification result"
```

---

## Task 2: 테스트 인프라 + video 패키지 골격

`Reels maker`에는 테스트 프레임워크가 전혀 없다. 이후 모든 Task가 TDD로 진행되므로 여기서 세운다. 동시에 세로 컴포지션 골격을 만든다.

**React 19 확인 지점:** `Reels maker`는 React 19, `youtube-voice-long-main`은 React 18이다. Remotion 4가 React 19에서 동작하는지 이 Task에서 확인된다. 설치나 렌더가 React 버전 때문에 실패하면 즉시 보고한다.

**Files:**
- Modify: `package.json`, `next.config.mjs` (`transpilePackages` 추가 — 이게 없으면 후속 Task가 `@studio/video/src/types`를 서버 코드에서 import할 때 빌드가 깨진다)
- Create: `vitest.config.ts`, `packages/video/package.json`, `packages/video/src/types.ts`, `packages/video/src/Root.tsx`, `packages/video/src/index.ts`, `packages/video/src/ReelVertical.tsx`
- Test: `packages/video/src/__tests__/composition.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `Palette { accent: string; ink: string; paper: string }` — 스펙 §6의 `StyleSheet.palette`와 같은 형태
  - `ReelProps { subtitles: SubtitleJSON; audioUrl: string | null; scenes: SceneDirective[]; durationInSeconds: number; palette: Palette; backgroundImageUrl?: string; characterImageUrl?: string }`
  - `FALLBACK_ACCENT = '#caff00'`, `FALLBACK_PALETTE: Palette` — 팔레트가 주어지지 않을 때(Remotion Studio 프리뷰 등)만 쓰는 최후 기본값. **컴포넌트는 색을 직접 정하지 않는다. 색 리터럴은 이 파일에만 존재한다**
  - `SubtitleWord { word: string; start: number; end: number }`
  - `SubtitleSegment { id: number; text: string; start: number; end: number; words: SubtitleWord[] }`
  - `type SubtitleJSON = SubtitleSegment[]`
  - `TitleCardScene { type: 'title_card'; startTime: number; endTime: number; title: string; subtitle?: string; colorAccent?: string }`
  - `type SceneDirective = TitleCardScene`
  - 컴포지션 id `ReelVertical`, 1080×1920, fps 30

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/video/src/__tests__/composition.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { REEL_WIDTH, REEL_HEIGHT, REEL_FPS, calculateDurationInFrames } from '../Root';

describe('ReelVertical composition', () => {
  it('is 1080x1920 at 30fps', () => {
    expect(REEL_WIDTH).toBe(1080);
    expect(REEL_HEIGHT).toBe(1920);
    expect(REEL_FPS).toBe(30);
  });

  it('derives frame count from duration', () => {
    expect(calculateDurationInFrames(30)).toBe(900);
    expect(calculateDurationInFrames(15.5)).toBe(465);
  });

  it('never returns zero frames', () => {
    expect(calculateDurationInFrames(0)).toBe(1);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run packages/video/src/__tests__/composition.test.ts
```

기대: FAIL — `Cannot find module '../Root'`

- [ ] **Step 3: vitest와 워크스페이스 설정**

`package.json`에 추가:

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "studio": "npm -w @studio/video run studio"
  }
}
```

`devDependencies`에 `vitest@^2`, `@vitejs/plugin-react@^4`를 추가하고 `npm install`.

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'node', include: ['**/__tests__/**/*.test.ts?(x)'] },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
```

`next.config.mjs` — 워크스페이스 패키지의 TypeScript를 직접 import하므로 트랜스파일 대상에 넣는다. 이게 없으면 `@studio/video/src/types`를 import하는 서버 코드가 빌드에서 깨진다:

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@studio/video'],
};

export default nextConfig;
```

`packages/video/package.json`:

```json
{
  "name": "@studio/video",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "studio": "remotion studio src/index.ts",
    "bundle": "remotion bundle src/index.ts --out-dir dist"
  },
  "dependencies": {
    "remotion": "^4.0.0",
    "@remotion/cli": "^4.0.0",
    "@remotion/bundler": "^4.0.0",
    "@remotion/renderer": "^4.0.0"
  }
}
```

- [ ] **Step 4: 타입과 컴포지션 구현**

`packages/video/src/types.ts`:

```ts
export interface SubtitleWord { word: string; start: number; end: number }
export interface SubtitleSegment {
  id: number; text: string; start: number; end: number; words: SubtitleWord[];
}
export type SubtitleJSON = SubtitleSegment[];

export interface TitleCardScene {
  type: 'title_card';
  startTime: number;
  endTime: number;
  title: string;
  subtitle?: string;
  colorAccent?: string;
  /** 이 씬에만 적용할 배경. 없으면 ReelProps.backgroundImageUrl을 쓴다 */
  backgroundImageUrl?: string;
}
export type SceneDirective = TitleCardScene;

export interface ReelProps {
  subtitles: SubtitleJSON;
  audioUrl: string | null;
  scenes: SceneDirective[];
  durationInSeconds: number;
  /** StyleSheet.palette 전체. 컴포넌트는 색을 직접 정하지 않는다 */
  palette: Palette;
  /** 스타일 시트 배경 라이브러리에서 고른 이미지. AI 생성 질감을 코드 모션 아래에 깐다 */
  backgroundImageUrl?: string;
  characterImageUrl?: string;
}

export interface Palette {
  accent: string;
  ink: string;
  paper: string;
}

/**
 * 팔레트가 주어지지 않았을 때만 쓰는 최후 기본값. `lib/style-sheet.ts`의 `studio` 프리셋과
 * 같은 값이다 — video 패키지는 독립 실행되므로 lib에서 import할 수 없어 여기 한 번 적는다.
 * 색 리터럴이 허용되는 파일은 이 파일뿐이다.
 */
export const FALLBACK_ACCENT = '#caff00';
export const FALLBACK_PALETTE: Palette = {
  accent: FALLBACK_ACCENT,
  ink: '#f4f4f0',
  paper: '#0d0f10',
};
```

`packages/video/src/Root.tsx`:

```tsx
import React from 'react';
import { Composition } from 'remotion';
import { ReelVertical } from './ReelVertical';
import type { ReelProps } from './types';
import { FALLBACK_PALETTE } from './types';

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

export function calculateDurationInFrames(durationInSeconds: number): number {
  return Math.max(1, Math.ceil(durationInSeconds * REEL_FPS));
}

export const RemotionRoot: React.FC = () => (
  <Composition
    id="ReelVertical"
    component={ReelVertical}
    width={REEL_WIDTH}
    height={REEL_HEIGHT}
    fps={REEL_FPS}
    durationInFrames={calculateDurationInFrames(30)}
    calculateMetadata={async ({ props }: { props: ReelProps }) => ({
      durationInFrames: calculateDurationInFrames(props.durationInSeconds),
    })}
    defaultProps={{
      subtitles: [],
      audioUrl: null,
      scenes: [],
      durationInSeconds: 5,
      palette: FALLBACK_PALETTE,
    } satisfies ReelProps}
  />
);
```

`packages/video/src/index.ts`:

```ts
import { registerRoot } from 'remotion';
import { RemotionRoot } from './Root';
registerRoot(RemotionRoot);
```

`packages/video/src/ReelVertical.tsx` (이번 Task에서는 최소 구현):

```tsx
import React from 'react';
import { AbsoluteFill, Audio } from 'remotion';
import type { ReelProps } from './types';

export const ReelVertical: React.FC<ReelProps> = ({ audioUrl, palette }) => (
  <AbsoluteFill style={{ backgroundColor: palette.paper }}>
    {audioUrl && <Audio src={audioUrl} />}
  </AbsoluteFill>
);
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run packages/video/src/__tests__/composition.test.ts
```

기대: 3개 PASS

- [ ] **Step 6: 세로 렌더가 실제로 나오는지 확인**

```bash
npx remotion render packages/video/src/index.ts ReelVertical /tmp/vertical.mp4 --frames=0-29
ffprobe -v error -show_entries stream=width,height -of default=noprint_wrappers=1 /tmp/vertical.mp4
```

기대: `width=1080`, `height=1920`

React 19에서 실패하면 여기서 멈추고 보고한다.

- [ ] **Step 7: 커밋**

```bash
git add package.json package-lock.json vitest.config.ts packages/
git commit -m "feat: add vitest and vertical reel composition skeleton"
```

---

## Task 3: 애니메이션 유틸과 세로 TitleCard 씬

**Files:**
- Create: `packages/video/src/utils/animations.ts`, `packages/video/src/scenes/TitleCard.tsx`, `packages/video/src/scenes/SceneRouter.tsx`
- Test: `packages/video/src/__tests__/animations.test.ts`, `packages/video/src/__tests__/sceneRouter.test.ts`

**Interfaces:**
- Consumes: `SceneDirective`, `TitleCardScene` (Task 2)
- Produces:
  - `SPRING_PRESETS: { gentle: { damping: number; stiffness: number } }`
  - `getEntryExitOpacity(sceneFrame: number, sceneDuration: number): number`
  - `getExitBlur(sceneFrame: number, sceneDuration: number): number`
  - `getEntryExitScale(sceneFrame: number, sceneDuration: number, fps: number, from: number, to: number): number`
  - `findActiveScene(scenes: SceneDirective[], currentTime: number): SceneDirective | undefined`
  - `<SceneRouter scenes={...} palette={...} />`

**배경 처리**: `scene.backgroundImageUrl`이 있으면 AI 생성 이미지를 깔고 위에 어두운 오버레이(45%)를 얹어 글자 가독성을 확보한다. 없으면 팔레트 그라디언트로 대체한다. **계획 1에서는 배경 라이브러리가 비어 있으므로 그라디언트 경로가 기본이다** — 두 경로 다 렌더되는지 Step 5에서 확인한다.

원본은 `youtube-voice-long-main/packages/remotion-video/src/components/scenes/TitleCard.tsx`다. 세로 전환에서 바뀌는 값: `fontSize` 90→72, `maxWidth` 1400→920, `padding` `0 80px`→`0 60px`, 부제 `fontSize` 40→32, `maxWidth` 1200→860, 장식선 폭 300→240.

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/video/src/__tests__/animations.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

describe('getEntryExitOpacity', () => {
  it('fades in over the first 10 frames', () => {
    expect(getEntryExitOpacity(0, 90)).toBe(0);
    expect(getEntryExitOpacity(10, 90)).toBe(1);
  });

  it('stays opaque in the middle', () => {
    expect(getEntryExitOpacity(45, 90)).toBe(1);
  });

  it('fades out over the last 10 frames', () => {
    expect(getEntryExitOpacity(90, 90)).toBe(0);
  });
});

describe('getExitBlur', () => {
  it('is zero until the exit window', () => {
    expect(getExitBlur(45, 90)).toBe(0);
  });

  it('grows at the end', () => {
    expect(getExitBlur(90, 90)).toBeGreaterThan(0);
  });
});

// Remotion의 interpolate는 입력 범위가 엄격히 증가해야 한다. 짧은 씬에서 범위가 무너지면
// 렌더 도중 예외가 난다 — 긴 씬 테스트만으로는 절대 잡히지 않는 종류의 결함이다.
describe('short scenes do not break the interpolate ranges', () => {
  const shortDurations = [1, 2, 3, 5, 15, 21];

  it('never throws for any short duration', () => {
    for (const dur of shortDurations) {
      for (const frame of [0, Math.floor(dur / 2), dur]) {
        expect(() => getEntryExitOpacity(frame, dur)).not.toThrow();
        expect(() => getExitBlur(frame, dur)).not.toThrow();
        expect(() => getEntryExitScale(frame, dur, 30, 0.8, 1.08)).not.toThrow();
      }
    }
  });

  it('keeps opacity inside 0..1 for short scenes', () => {
    for (const dur of shortDurations) {
      const value = getEntryExitOpacity(Math.floor(dur / 2), dur);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('skips the fade entirely when the scene is too short for one', () => {
    expect(getEntryExitOpacity(0, 2)).toBe(1);
    expect(getExitBlur(2, 2)).toBe(0);
  });
});
```

`packages/video/src/__tests__/sceneRouter.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { findActiveScene } from '../scenes/SceneRouter';
import type { SceneDirective } from '../types';

const scenes: SceneDirective[] = [
  { type: 'title_card', startTime: 0, endTime: 3, title: '첫 씬' },
  { type: 'title_card', startTime: 3, endTime: 6, title: '둘째 씬' },
];

describe('findActiveScene', () => {
  it('picks the scene containing the time', () => {
    expect(findActiveScene(scenes, 1)?.title).toBe('첫 씬');
    expect(findActiveScene(scenes, 4)?.title).toBe('둘째 씬');
  });

  it('treats endTime as exclusive', () => {
    expect(findActiveScene(scenes, 3)?.title).toBe('둘째 씬');
  });

  it('returns undefined past the last scene', () => {
    expect(findActiveScene(scenes, 10)).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run packages/video/src/__tests__/animations.test.ts packages/video/src/__tests__/sceneRouter.test.ts
```

기대: FAIL — 모듈을 찾을 수 없음

- [ ] **Step 3: 유틸 구현**

`packages/video/src/utils/animations.ts`:

```ts
import { interpolate } from 'remotion';

export const SPRING_PRESETS = {
  gentle: { damping: 20, stiffness: 100 },
} as const;

const ENTRY_FRAMES = 10;
const EXIT_FRAMES = 10;

/**
 * Remotion의 interpolate는 입력 범위가 **엄격히 증가**해야 한다. 짧은 씬에서 고정 상수를 그대로
 * 쓰면 값이 중복되거나 역전되어 런타임 예외가 난다. 창을 duration에 맞춰 좁히고, 창을 만들 수
 * 없을 만큼 짧으면 페이드를 생략한다.
 */
function fadeWindows(sceneDuration: number) {
  const room = Math.floor((sceneDuration - 1) / 2);
  return {
    entry: Math.min(ENTRY_FRAMES, room),
    exit: Math.min(EXIT_FRAMES, room),
  };
}

export function getEntryExitOpacity(sceneFrame: number, sceneDuration: number): number {
  const { entry, exit } = fadeWindows(sceneDuration);
  if (entry <= 0 || exit <= 0) return 1;
  return interpolate(
    sceneFrame,
    [0, entry, sceneDuration - exit, sceneDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

export function getExitBlur(sceneFrame: number, sceneDuration: number): number {
  const { exit } = fadeWindows(sceneDuration);
  if (exit <= 0) return 0;
  return interpolate(
    sceneFrame,
    [sceneDuration - exit, sceneDuration],
    [0, 8],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}

export function getEntryExitScale(
  sceneFrame: number,
  sceneDuration: number,
  fps: number,
  from: number,
  to: number,
): number {
  const mid = Math.min(Math.round(fps * 0.5), sceneDuration - 1);
  if (mid <= 0) return to;
  return interpolate(
    sceneFrame,
    [0, mid, sceneDuration],
    [from, 1, to],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
}
```

- [ ] **Step 4: TitleCard와 SceneRouter 구현**

`packages/video/src/scenes/TitleCard.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill, Img, spring, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { Palette, TitleCardScene } from '../types';
import { SPRING_PRESETS, getEntryExitOpacity, getExitBlur, getEntryExitScale } from '../utils/animations';

export const TitleCard: React.FC<{ scene: TitleCardScene; palette: Palette }> = ({ scene, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const sceneFrame = frame - Math.round(scene.startTime * fps);
  const sceneDuration = Math.round((scene.endTime - scene.startTime) * fps);
  const accent = scene.colorAccent ?? palette.accent;

  const titleSpring = spring({ frame: sceneFrame, fps, config: SPRING_PRESETS.gentle });
  const opacity = getEntryExitOpacity(sceneFrame, sceneDuration);
  const exitBlur = getExitBlur(sceneFrame, sceneDuration);
  const exitScale = getEntryExitScale(sceneFrame, sceneDuration, fps, 0.8, 1.08);
  const subOpacity = interpolate(sceneFrame, [10, 20], [0, 1], { extrapolateRight: 'clamp' });
  const subY = interpolate(sceneFrame, [10, 25], [30, 0], { extrapolateRight: 'clamp' });
  const lineWidth = interpolate(sceneFrame, [5, 20], [0, 240], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 24, opacity,
        filter: exitBlur > 0 ? `blur(${exitBlur}px)` : undefined,
        transform: `scale(${exitScale})`,
      }}
    >
      {/* 배경: AI 생성 이미지가 있으면 깔고, 없으면 팔레트 그라디언트로 대체 */}
      {scene.backgroundImageUrl ? (
        <AbsoluteFill>
          <Img src={scene.backgroundImageUrl} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill style={{ background: `${palette.paper}73` }} />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{
          background: `radial-gradient(ellipse at center, ${accent}25 0%, ${palette.paper}f2 70%)`,
        }} />
      )}

      <div style={{
        position: 'relative',
        fontSize: 72, fontWeight: 900, fontFamily: "'Pretendard', sans-serif",
        color: palette.ink, textAlign: 'center', maxWidth: 920, lineHeight: 1.2, padding: '0 60px',
        transform: `scale(${interpolate(titleSpring, [0, 1], [0.8, 1])})`,
        textShadow: `0 4px 40px ${accent}60, 0 2px 8px ${palette.paper}cc`,
      }}>{scene.title}</div>

      {scene.subtitle && (
        <div style={{
          position: 'relative',
          fontSize: 32, fontWeight: 500, fontFamily: "'Pretendard', sans-serif",
          color: `${accent}cc`, textAlign: 'center', maxWidth: 860, lineHeight: 1.4,
          opacity: subOpacity, transform: `translateY(${subY}px)`,
        }}>{scene.subtitle}</div>
      )}

      <div style={{
        position: 'relative',
        width: lineWidth, height: 4, borderRadius: 2, marginTop: 16,
        background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
      }} />
    </AbsoluteFill>
  );
};
```

`packages/video/src/scenes/SceneRouter.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Palette, SceneDirective } from '../types';
import { TitleCard } from './TitleCard';

export function findActiveScene(
  scenes: SceneDirective[],
  currentTime: number,
): SceneDirective | undefined {
  return scenes.find((s) => currentTime >= s.startTime && currentTime < s.endTime);
}

export const SceneRouter: React.FC<{ scenes: SceneDirective[]; palette: Palette }> = ({ scenes, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const active = findActiveScene(scenes, frame / fps);
  return (
    <AbsoluteFill>
      {active?.type === 'title_card' && <TitleCard scene={active} palette={palette} />}
    </AbsoluteFill>
  );
};
```

- [ ] **Step 5: 색 리터럴 가드 테스트 추가**

이 제약은 지금까지 두 번 깨졌다. 사람이 지키는 규칙 대신 테스트가 지키게 한다.

`packages/video/src/__tests__/no-color-literals.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const ALLOWED_BASENAMES = ['types.ts'];
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe('colour literals live only in types.ts', () => {
  it('finds none in any other source file', () => {
    const offenders = walk(SRC)
      .filter((f) => /\.tsx?$/.test(f))
      .filter((f) => !f.includes('__tests__'))
      .filter((f) => !ALLOWED_BASENAMES.includes(path.basename(f)))
      .filter((f) => COLOR_LITERAL.test(readFileSync(f, 'utf8')));

    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });
});
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npx vitest run packages/video/src/__tests__/
npx tsc --noEmit
```

기대: 전부 PASS, tsc 무출력

- [ ] **Step 7: 커밋**

```bash
git add packages/video/src
git commit -m "feat: add vertical title card scene and animation utils"
```

---

## Task 4: 자막과 음성 에너지

**Files:**
- Create: `packages/video/src/utils/voiceAnalysis.ts`, `packages/video/src/components/Subtitles.tsx`
- Modify: `packages/video/src/ReelVertical.tsx`, `packages/video/src/__tests__/no-color-literals.test.ts` (정규식 강화)
- Test: `packages/video/src/__tests__/voiceAnalysis.test.ts`

**Interfaces:**
- Consumes: `SubtitleJSON`, `SceneDirective`, `SceneRouter`, `TitleCard`
- Produces:
  - `analyzeVoiceState(subtitles: SubtitleJSON, currentTime: number): { isSpeaking: boolean; energy: number; currentWordIndex: number }`
  - `<Subtitles subtitles={...} currentTime={...} bottom={...} palette={...} />`
  - `ReelVertical`이 배경·오디오·씬·자막을 모두 조립한 상태가 된다

- [ ] **Step 1: 색 가드를 CSS 키워드까지 잡도록 강화**

Task 3의 가드는 `#hex`와 `rgb()/rgba()`만 잡는다. `color: 'white'` 같은 **CSS 색 키워드는 통과한다** —
자막이 정확히 그 형태를 쓸 예정이라 구멍을 먼저 막는다.

`packages/video/src/__tests__/no-color-literals.test.ts`의 정규식을 교체한다:

```ts
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|(['"`])\s*(white|black|red|blue|green|gray|grey|yellow|orange|purple|pink|cyan|magenta|silver|gold|navy|teal|maroon|olive|lime|aqua|fuchsia)\s*\1/i;
```

```bash
npx vitest run packages/video/src/__tests__/no-color-literals.test.ts
```

기대: **PASS** — 강화한 뒤에도 기존 소스에는 위반이 없어야 한다. 여기서 실패하면 Task 3이 놓친
위반이 있다는 뜻이니 보고할 것.

- [ ] **Step 2: 실패하는 테스트 작성**

`packages/video/src/__tests__/voiceAnalysis.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { analyzeVoiceState } from '../utils/voiceAnalysis';
import type { SubtitleJSON } from '../types';

const subs: SubtitleJSON = [{
  id: 0, text: '안녕하세요 반갑습니다', start: 0, end: 2,
  words: [
    { word: '안녕하세요', start: 0, end: 1 },
    { word: '반갑습니다', start: 1, end: 2 },
  ],
}];

describe('analyzeVoiceState', () => {
  it('reports silence outside every segment', () => {
    const s = analyzeVoiceState(subs, 5);
    expect(s.isSpeaking).toBe(false);
    expect(s.energy).toBe(0);
  });

  it('reports speaking inside a segment', () => {
    expect(analyzeVoiceState(subs, 0.5).isSpeaking).toBe(true);
  });

  it('tracks the current word index', () => {
    expect(analyzeVoiceState(subs, 0.5).currentWordIndex).toBe(0);
    expect(analyzeVoiceState(subs, 1.5).currentWordIndex).toBe(1);
  });

  it('keeps energy within 0..1', () => {
    const s = analyzeVoiceState(subs, 1.5);
    expect(s.energy).toBeGreaterThanOrEqual(0);
    expect(s.energy).toBeLessThanOrEqual(1);
  });

  it('handles empty subtitles', () => {
    expect(analyzeVoiceState([], 1).isSpeaking).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
npx vitest run packages/video/src/__tests__/voiceAnalysis.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 4: voiceAnalysis 구현**

원본 `youtube-voice-long-main/packages/remotion-video/src/utils/voiceAnalysis.ts`에서 이식하되, 계획 1에서 쓰지 않는 `pauseDuration`·`segmentProgress`·`speechRate` 반환은 제거하고 위 인터페이스로 줄인다.

`packages/video/src/utils/voiceAnalysis.ts`:

```ts
import type { SubtitleJSON } from '../types';

export interface VoiceState {
  isSpeaking: boolean;
  energy: number;
  currentWordIndex: number;
}

const SILENT: VoiceState = { isSpeaking: false, energy: 0, currentWordIndex: 0 };

export function analyzeVoiceState(subtitles: SubtitleJSON, currentTime: number): VoiceState {
  if (!subtitles?.length) return SILENT;

  const seg = subtitles.find((s) => currentTime >= s.start && currentTime <= s.end);
  if (!seg) return SILENT;

  const words = seg.words;
  let currentWordIndex = 0;
  for (let i = 0; i < words.length; i++) {
    if (currentTime >= words[i].start) currentWordIndex = i;
  }

  const segDuration = seg.end - seg.start;
  const density = segDuration > 0 ? words.length / segDuration : 0;
  const energy = Math.min(1, Math.max(0, density / 5));

  return { isSpeaking: true, energy, currentWordIndex };
}
```

- [ ] **Step 5: Subtitles와 ReelVertical 조립**

`packages/video/src/components/Subtitles.tsx`:

```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';
import type { Palette, SubtitleJSON } from '../types';
import { analyzeVoiceState } from '../utils/voiceAnalysis';

interface Props { subtitles: SubtitleJSON; currentTime: number; bottom: number; palette: Palette }

export const Subtitles: React.FC<Props> = ({ subtitles, currentTime, bottom, palette }) => {
  const seg = subtitles.find((s) => currentTime >= s.start && currentTime <= s.end);
  if (!seg) return null;
  const { currentWordIndex } = analyzeVoiceState(subtitles, currentTime);

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: bottom }}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 12,
        maxWidth: 940, padding: '0 40px',
        fontFamily: "'Pretendard', sans-serif", fontSize: 46, fontWeight: 800, lineHeight: 1.35,
      }}>
        {seg.words.map((w, i) => (
          <span key={`${w.start}-${i}`} style={{
            color: i === currentWordIndex ? palette.accent : palette.ink,
            textShadow: `0 2px 12px ${palette.paper}e6`,
          }}>{w.word}</span>
        ))}
      </div>
    </AbsoluteFill>
  );
};
```

`packages/video/src/ReelVertical.tsx` 전체 교체:

```tsx
import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ReelProps } from './types';
import { SceneRouter } from './scenes/SceneRouter';
import { Subtitles } from './components/Subtitles';

export const ReelVertical: React.FC<ReelProps> = ({ subtitles, audioUrl, scenes, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTime = frame / fps;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.paper }}>
      {audioUrl && <Audio src={audioUrl} />}
      <AbsoluteFill style={{ zIndex: 10 }}><SceneRouter scenes={scenes} palette={palette} /></AbsoluteFill>
      <AbsoluteFill style={{ zIndex: 20 }}>
        <Subtitles subtitles={subtitles} currentTime={currentTime} bottom={160} palette={palette} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
```

- [ ] **Step 6: 테스트 통과 및 실제 렌더 확인**

```bash
npx vitest run packages/video/src/__tests__/
npx remotion render packages/video/src/index.ts ReelVertical /tmp/reel.mp4 \
  --props='{"subtitles":[{"id":0,"text":"무릎 통증 잡는 법","start":0,"end":2,"words":[{"word":"무릎","start":0,"end":0.7},{"word":"통증","start":0.7,"end":1.4},{"word":"잡는 법","start":1.4,"end":2}]}],"audioUrl":null,"scenes":[{"type":"title_card","startTime":0,"endTime":2,"title":"무릎 통증 잡는 법"}],"durationInSeconds":2,"palette":{"accent":"#caff00","ink":"#f4f4f0","paper":"#0d0f10"}}'
```

기대: 테스트 PASS, 1080×1920 MP4에 타이틀과 자막이 보인다. 재생해서 눈으로 확인한다.

- [ ] **Step 7: 커밋**

```bash
git add packages/video/src
git commit -m "feat: add word-level subtitles and voice energy analysis"
```

---

## Task 5: 저장소 계층 — store · jobs · projects

`lib/mock-jobs.ts`의 인메모리 `Map`은 서버 재시작 시 사라지고, 서버리스에서는 요청마다 인스턴스가 달라 아예 동작하지 않는다. 배포가 목표이므로 반드시 교체한다.

**Files:**
- Create: `lib/store/types.ts`, `lib/store/file-store.ts`, `lib/store/index.ts`, `lib/jobs.ts`, `lib/projects.ts`
- Test: `lib/__tests__/jobs.test.ts`, `lib/__tests__/projects.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `Store { read<T>(key, fallback): Promise<T>; write<T>(key, value): Promise<void> }`
  - `fileStore` — `STORE_DIR` 환경변수로 데이터 경로를 바꿀 수 있다. **경로는 호출 시점에 정해진다** (테스트가 임시 디렉터리를 쓸 수 있어야 하므로)
  - `store` — **모든 프로덕션 코드가 쓰는 단일 진입점.** `fileStore`를 직접 import하지 않는다 (Global Constraints). 테스트는 시드·초기화 목적으로 `fileStore`를 직접 써도 된다
  - `Project { id: string; ownerId: string; engine: 'remotion'; script: string; audioUrl: string|null; subtitles: SubtitleJSON|null; scenes: SceneDirective[]|null; resultUrl: string|null; createdAt: string }`
  - `createProject(input: { ownerId: string; script: string }): Promise<Project>`
  - `getProject(id: string): Promise<Project | null>`
  - `RenderJob { id: string; projectId: string; ownerId: string; engine: 'remotion'; status: 'queued'|'claimed'|'rendering'|'completed'|'failed'; progress: number; claimedAt: string|null; resultUrl: string|null; error: string|null; createdAt: string }`
  - `enqueueJob(input: { projectId: string; ownerId: string }): Promise<RenderJob>`
  - `claimNextJob(now?: Date): Promise<RenderJob | null>`
  - `updateJob(id: string, patch: Partial<Pick<RenderJob,'status'|'progress'|'resultUrl'|'error'>>): Promise<RenderJob | null>`
  - `getJob(id: string): Promise<RenderJob | null>`
  - `STALE_CLAIM_MS = 15 * 60 * 1000`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/jobs.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { enqueueJob, claimNextJob, updateJob, getJob, STALE_CLAIM_MS } from '../jobs';
import { resetStoreForTests } from '../store/file-store';

// 실제 .local-data/를 건드리지 않는다 — 거기엔 사용자의 학습 기록이 들어 있다.
beforeEach(async () => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
  await resetStoreForTests();
});

describe('job queue', () => {
  it('enqueues a job in queued state', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    expect(job.status).toBe('queued');
    expect(job.progress).toBe(0);
  });

  it('claims the oldest queued job exactly once', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await enqueueJob({ projectId: 'p2', ownerId: 'u1' });
    const first = await claimNextJob();
    const second = await claimNextJob();
    expect(first?.projectId).toBe('p1');
    expect(second?.projectId).toBe('p2');
    expect(await claimNextJob()).toBeNull();
  });

  it('marks claimed jobs so they are not handed out again', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const claimed = await claimNextJob();
    expect(claimed?.status).toBe('claimed');
    expect(claimed?.claimedAt).not.toBeNull();
  });

  it('reclaims a job whose claim went stale', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const claimed = await claimNextJob(new Date('2026-01-01T00:00:00Z'));
    expect(claimed).not.toBeNull();
    const later = new Date(Date.parse('2026-01-01T00:00:00Z') + STALE_CLAIM_MS + 1000);
    const reclaimed = await claimNextJob(later);
    expect(reclaimed?.id).toBe(claimed!.id);
  });

  it('records completion', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await updateJob(job.id, { status: 'completed', progress: 100, resultUrl: '/out.mp4' });
    const found = await getJob(job.id);
    expect(found?.status).toBe('completed');
    expect(found?.resultUrl).toBe('/out.mp4');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run lib/__tests__/jobs.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 저장소 인터페이스와 파일 구현체**

`lib/store/types.ts`:

```ts
export interface Store {
  read<T>(key: string, fallback: T): Promise<T>;
  write<T>(key: string, value: T): Promise<void>;
}
```

`lib/store/file-store.ts`:

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from './types';

/**
 * 호출 시점에 경로를 정한다. 모듈 로드 시점에 고정하면 테스트가 `STORE_DIR`로 임시 디렉터리를
 * 가리킬 수 없고, 그러면 테스트가 사용자의 실제 `.local-data/`에 쓰게 된다.
 */
function dataDir(): string {
  return process.env.STORE_DIR ?? path.join(process.cwd(), '.local-data');
}

export const fileStore: Store = {
  async read<T>(key: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(path.join(dataDir(), `${key}.json`), 'utf8')) as T;
    } catch {
      return fallback;
    }
  },
  async write<T>(key: string, value: T): Promise<void> {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(path.join(dataDir(), `${key}.json`), JSON.stringify(value, null, 2), 'utf8');
  },
};

export async function resetStoreForTests(): Promise<void> {
  await fileStore.write('jobs', []);
  await fileStore.write('projects', []);
}
```

`lib/store/index.ts` — 프로덕션 코드는 항상 이 진입점을 쓴다. Task 12에서 배포용 Blob 구현체가 붙을 때 이 파일만 바뀐다:

```ts
import { fileStore } from './file-store';
import type { Store } from './types';

export const store: Store = fileStore;
```

`lib/projects.ts`:

```ts
import { store } from './store';
import type { SubtitleJSON, SceneDirective } from '@studio/video/src/types';

export interface Project {
  id: string; ownerId: string; engine: 'remotion'; script: string;
  audioUrl: string | null; subtitles: SubtitleJSON | null;
  scenes: SceneDirective[] | null; resultUrl: string | null; createdAt: string;
}

const KEY = 'projects';

export async function createProject(input: { ownerId: string; script: string }): Promise<Project> {
  const projects = await store.read<Project[]>(KEY, []);
  const project: Project = {
    id: `proj_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    ownerId: input.ownerId, engine: 'remotion', script: input.script,
    audioUrl: null, subtitles: null, scenes: null, resultUrl: null,
    createdAt: new Date().toISOString(),
  };
  await store.write(KEY, [project, ...projects]);
  return project;
}

export async function getProject(id: string): Promise<Project | null> {
  return (await store.read<Project[]>(KEY, [])).find((p) => p.id === id) ?? null;
}
```

`lib/__tests__/projects.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject, getProject } from '../projects';
import { resetStoreForTests } from '../store/file-store';

beforeEach(async () => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
  await resetStoreForTests();
});

describe('createProject', () => {
  it('stores the script and returns an id', async () => {
    const p = await createProject({ ownerId: 'u1', script: '무릎 통증 팁' });
    expect(p.script).toBe('무릎 통증 팁');
    expect((await getProject(p.id))?.ownerId).toBe('u1');
  });

  it('starts with no result', async () => {
    expect((await createProject({ ownerId: 'u1', script: '대본' })).resultUrl).toBeNull();
  });

  it('returns null for an unknown id', async () => {
    expect(await getProject('nope')).toBeNull();
  });
});
```

- [ ] **Step 4: 큐 로직 구현**

`lib/jobs.ts`:

```ts
import { store } from './store';

export const STALE_CLAIM_MS = 15 * 60 * 1000;

export interface RenderJob {
  id: string;
  projectId: string;
  ownerId: string;
  engine: 'remotion';
  status: 'queued' | 'claimed' | 'rendering' | 'completed' | 'failed';
  progress: number;
  claimedAt: string | null;
  resultUrl: string | null;
  error: string | null;
  createdAt: string;
}

const KEY = 'jobs';
const read = () => store.read<RenderJob[]>(KEY, []);
const write = (jobs: RenderJob[]) => store.write(KEY, jobs);

export async function enqueueJob(input: { projectId: string; ownerId: string }): Promise<RenderJob> {
  const jobs = await read();
  const job: RenderJob = {
    id: `job_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    projectId: input.projectId,
    ownerId: input.ownerId,
    engine: 'remotion',
    status: 'queued',
    progress: 0,
    claimedAt: null,
    resultUrl: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  await write([...jobs, job]);
  return job;
}

function isClaimable(job: RenderJob, now: Date): boolean {
  if (job.status === 'queued') return true;
  if (job.status !== 'claimed' && job.status !== 'rendering') return false;
  if (!job.claimedAt) return false;
  return now.getTime() - Date.parse(job.claimedAt) > STALE_CLAIM_MS;
}

export async function claimNextJob(now: Date = new Date()): Promise<RenderJob | null> {
  const jobs = await read();
  const target = jobs
    .filter((j) => isClaimable(j, now))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
  if (!target) return null;

  const claimed: RenderJob = { ...target, status: 'claimed', claimedAt: now.toISOString() };
  await write(jobs.map((j) => (j.id === claimed.id ? claimed : j)));
  return claimed;
}

export async function updateJob(
  id: string,
  patch: Partial<Pick<RenderJob, 'status' | 'progress' | 'resultUrl' | 'error'>>,
): Promise<RenderJob | null> {
  const jobs = await read();
  const next = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  await write(next);
  return next.find((j) => j.id === id) ?? null;
}

export async function getJob(id: string): Promise<RenderJob | null> {
  return (await read()).find((j) => j.id === id) ?? null;
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run lib/__tests__/jobs.test.ts lib/__tests__/projects.test.ts
```

기대: 잡 5개 + 프로젝트 3개 = 8개 PASS

- [ ] **Step 6: 커밋**

```bash
git add lib/store lib/jobs.ts lib/projects.ts lib/__tests__
git commit -m "feat: add persistent store layer with job queue and projects"
```

---

## Task 6: 워커 API 라우트

**Files:**
- Create: `app/api/jobs/next/route.ts`, `app/api/jobs/[id]/route.ts`, `vitest.setup.ts`
- Modify: `vitest.config.ts` (`setupFiles` 추가)
- Test: `app/api/__tests__/jobs-route.test.ts`

**Interfaces:**
- Consumes: `claimNextJob`, `updateJob`, `getJob`, `getProject`, `createProject` (모두 Task 5)
- Produces:
  - `POST /api/jobs/next` — 헤더 `x-worker-token`. 200 `{ job: RenderJob | null, project: Project | null }`, 401 미인증. **워커가 파이프라인을 돌리려면 대본이 필요하므로 프로젝트를 함께 넘긴다**
  - `PATCH /api/jobs/:id` — 헤더 `x-worker-token`. 본문 `{ status?, progress?, resultUrl?, error? }`
  - `assertWorker(request: Request): boolean`

- [ ] **Step 1: 테스트 전역 격리 — 어떤 테스트도 실제 데이터를 못 건드리게**

Task 5는 테스트 파일마다 `STORE_DIR`을 임시 디렉터리로 돌렸다. 그 방식은 **저자가 매번 기억해야
한다** — 이 계획에만 이미 세 파일이 빠뜨렸다. 하네스 차원에서 보장한다.

`vitest.setup.ts` 생성:

```ts
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach } from 'vitest';

// 어떤 테스트도 사용자의 실제 .local-data/를 건드리지 않는다.
// 거기엔 학습 기록과 파일럿 산출물이 들어 있다.
beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
  // 배포용 Blob 구현체가 선택되지 않게 한다. `store`는 모듈 로드 시점에 결정되므로,
  // 앞선 테스트가 이 변수를 남기면 뒤 파일이 자격증명 없이 실제 Blob에 쓰려 한다.
  delete process.env.BLOB_READ_WRITE_TOKEN;
});
```

`vitest.config.ts`의 `test` 블록에 추가:

```ts
    setupFiles: ['./vitest.setup.ts'],
```

전역 훅이 파일별 `beforeEach`보다 먼저 돌므로, `resetStoreForTests()`는 이미 임시 디렉터리를
가리킨 상태에서 실행된다.

```bash
md5 -q .local-data/learning-records.json          # 실행 전 기록
npx vitest run
md5 -q .local-data/learning-records.json          # 같아야 한다
git status --porcelain .local-data                # 비어 있어야 한다
```

기대: 기존 29개 전부 통과, 실제 데이터 불변.

- [ ] **Step 2: 실패하는 테스트 작성**

`app/api/__tests__/jobs-route.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { POST as claimRoute } from '../jobs/next/route';
import { PATCH as patchRoute, GET as statusRoute } from '../jobs/[id]/route';
import { enqueueJob, getJob } from '@/lib/jobs';
import { resetStoreForTests } from '@/lib/store/file-store';

beforeEach(async () => {
  process.env.WORKER_TOKEN = 'test-token';
  await resetStoreForTests();
});

function req(token?: string) {
  return new Request('http://localhost/api/jobs/next', {
    method: 'POST',
    headers: token ? { 'x-worker-token': token } : {},
  });
}

describe('POST /api/jobs/next', () => {
  it('rejects a request with no token', async () => {
    expect((await claimRoute(req())).status).toBe(401);
  });

  it('rejects a wrong token', async () => {
    expect((await claimRoute(req('nope'))).status).toBe(401);
  });

  it('returns null when the queue is empty', async () => {
    const res = await claimRoute(req('test-token'));
    expect(res.status).toBe(200);
    expect((await res.json()).job).toBeNull();
  });

  it('hands out a queued job', async () => {
    await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await claimRoute(req('test-token'));
    expect((await res.json()).job.projectId).toBe('p1');
  });

  it('includes the project so the worker has the script', async () => {
    const { createProject } = await import('@/lib/projects');
    const project = await createProject({ ownerId: 'u1', script: '무릎 통증 팁' });
    await enqueueJob({ projectId: project.id, ownerId: 'u1' });
    const body = await (await claimRoute(req('test-token'))).json();
    expect(body.project.script).toBe('무릎 통증 팁');
  });

  it('reports a null project rather than hiding the job', async () => {
    await enqueueJob({ projectId: 'gone', ownerId: 'u1' });
    const body = await (await claimRoute(req('test-token'))).json();
    expect(body.job.projectId).toBe('gone');
    expect(body.project).toBeNull();
  });
});

// PATCH는 워커의 유일한 피드백 채널이다. 여기가 조용히 깨지면 잡이 claimed 상태로 묶인 채
// 스테일 회수까지 15분을 흘려보낸다. 배포 검증에서 발견하기엔 너무 비싼 실패다.
describe('PATCH /api/jobs/[id]', () => {
  function patchReq(id: string, token: string | undefined, body: unknown) {
    return new Request(`http://localhost/api/jobs/${id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'x-worker-token': token } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('rejects a request with no token', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await patchRoute(patchReq(job.id, undefined, { progress: 50 }), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a job that does not exist', async () => {
    const res = await patchRoute(patchReq('nope', 'test-token', { progress: 50 }), {
      params: Promise.resolve({ id: 'nope' }),
    });
    expect(res.status).toBe(404);
  });

  it('records progress reported by the worker', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await patchRoute(patchReq(job.id, 'test-token', { status: 'rendering', progress: 42 }), {
      params: Promise.resolve({ id: job.id }),
    });
    expect(res.status).toBe(200);
    expect((await getJob(job.id))?.progress).toBe(42);
    expect((await getJob(job.id))?.status).toBe('rendering');
  });

  it('records the result url on completion', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await patchRoute(patchReq(job.id, 'test-token', {
      status: 'completed', progress: 100, resultUrl: '/out/a.mp4',
    }), { params: Promise.resolve({ id: job.id }) });
    const stored = await getJob(job.id);
    expect(stored?.status).toBe('completed');
    expect(stored?.resultUrl).toBe('/out/a.mp4');
  });
});

describe('GET /api/jobs/[id]', () => {
  function getReq(id: string) {
    return new Request(`http://localhost/api/jobs/${id}`);
  }

  it('returns the polling shape the UI needs', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const body = await (await statusRoute(getReq(job.id), {
      params: Promise.resolve({ id: job.id }),
    })).json();
    expect(body).toEqual({ status: 'queued', progress: 0, resultUrl: null, error: null });
  });

  it('returns 404 for a job that does not exist', async () => {
    const res = await statusRoute(getReq('nope'), { params: Promise.resolve({ id: 'nope' }) });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: 테스트가 실패하는지 확인**

```bash
npx vitest run app/api/__tests__/jobs-route.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 4: 라우트 구현**

`app/api/jobs/next/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { claimNextJob } from '@/lib/jobs';
import { getProject } from '@/lib/projects';

export const dynamic = 'force-dynamic';

export function assertWorker(request: Request): boolean {
  const expected = process.env.WORKER_TOKEN;
  if (!expected) return false;
  return request.headers.get('x-worker-token') === expected;
}

export async function POST(request: Request) {
  if (!assertWorker(request)) {
    return NextResponse.json({ error: '인증되지 않은 워커입니다.' }, { status: 401 });
  }
  const job = await claimNextJob();
  if (!job) return NextResponse.json({ job: null, project: null });
  const project = await getProject(job.projectId);
  return NextResponse.json({ job, project });
}
```

`app/api/jobs/[id]/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { updateJob, getJob } from '@/lib/jobs';
import { assertWorker } from '../next/route';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!assertWorker(request)) {
    return NextResponse.json({ error: '인증되지 않은 워커입니다.' }, { status: 401 });
  }
  const { id } = await params;
  const patch = await request.json();
  const job = await updateJob(id, patch);
  if (!job) return NextResponse.json({ error: '존재하지 않는 작업입니다.' }, { status: 404 });
  return NextResponse.json({ job });
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJob(id);
  if (!job) return NextResponse.json({ error: '존재하지 않는 작업입니다.' }, { status: 404 });
  return NextResponse.json({
    status: job.status, progress: job.progress, resultUrl: job.resultUrl, error: job.error,
  });
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run app/api/__tests__/jobs-route.test.ts
```

기대: 12개 PASS (claim 6 + PATCH 4 + GET 2)

- [ ] **Step 6: 커밋**

```bash
git add app/api/jobs app/api/__tests__ vitest.setup.ts vitest.config.ts
git commit -m "feat: add worker job claim and report routes"
```

---

## Task 7: TTS와 STT 파이프라인

**Files:**
- Create: `lib/pipeline/tts.ts`, `lib/pipeline/stt.ts`
- Test: `lib/__tests__/stt.test.ts`

**Interfaces:**
- Consumes: `lib/fish-audio-client.ts`의 `synthesizeFishSpeech` (기존 코드, 수정하지 않음)
- Produces:
  - `synthesizeNarration(input: { text: string; referenceId: string; speakingSpeed?: number; instruct?: string }): Promise<{ audioPath: string }>` — 길이는 반환하지 않는다(항상 0이 되므로)
  - `transcribeToSubtitles(audioPath: string): Promise<SubtitleJSON>`
  - `parseWhisperJson(raw: unknown): SubtitleJSON`

STT는 워커(맥)에서 `whisper.cpp`를 로컬 실행한다.

```bash
brew install whisper-cpp
whisper-cli --help | head -1
```

> **바이너리 이름은 `whisper-cli`다.** whisper.cpp가 `main`을 `whisper-cli`로 개명했고 Homebrew의
> `whisper-cpp` 포뮬러가 설치하는 실행 파일도 그 이름이다. `whisper-cpp`라는 명령은 존재하지 않는다.
> 코드에서는 `WHISPER_BIN` 환경변수로 바꿀 수 있게 두되 기본값을 `whisper-cli`로 한다.

**모델은 절대 경로로 지정한다.** `WHISPER_MODEL`이 없으면 명확한 오류를 던지고 멈춘다 —
파일명만 적어두면 "모델을 찾을 수 없다"는 암호 같은 실패가 난다. 모델이 없으면 받는다:

```bash
mkdir -p .local-data/whisper
curl -L -o .local-data/whisper/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```

한국어 정확도가 부족하면 `ggml-small.bin` 이상으로 올린다.

### 실측으로 확인된 것 (2026-08-26, whisper-cpp 1.9.1)

이 세 가지는 실제로 돌려서 확인했다. 계획의 초안은 전부 틀렸었다.

| 항목 | 결과 |
|---|---|
| mp3 직접 입력 | **된다.** ffmpeg 내장 빌드라 wav 변환이 불필요하다 |
| `-oj` (output-json) | **`tokens` 필드를 주지 않는다.** 단어 타이밍을 못 얻는다 |
| `-ojf` (output-json-full) | **`tokens`를 준다.** 이걸 써야 한다 |
| `-ml 1` (max-len 1) | **한국어 UTF-8을 깨뜨린다.** 멀티바이트 문자를 바이트 경계에서 자른다 → `JSON.parse` 실패 |

`-ml`을 쓰지 않으면 세그먼트가 문장 단위로 나오고 그 안의 `tokens`가 단어 단위가 된다 —
`SubtitleSegment`(문장) + `words`(단어)라는 우리 모델과 정확히 맞는다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/stt.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseWhisperJson } from '../pipeline/stt';

// 실제 whisper-cli 1.9.1 `-ojf` 출력에서 가져온 구조다. 특수 토큰 두 종류가 섞여 나온다.
const whisperOutput = {
  transcription: [
    {
      timestamps: { from: '00:00:00,000', to: '00:00:04,900' },
      offsets: { from: 0, to: 4900 },
      text: ' 저는 운동을 좋아해서 뛰어요.',
      tokens: [
        { text: '[_BEG_]', offsets: { from: 0, to: 0 } },
        { text: ' 저는', offsets: { from: 130, to: 550 } },
        { text: ' 운동', offsets: { from: 870, to: 1160 } },
        { text: '을', offsets: { from: 1160, to: 1380 } },
        { text: '[_TT_245]', offsets: { from: 4900, to: 4900 } },
      ],
    },
  ],
};

describe('parseWhisperJson', () => {
  it('converts milliseconds to seconds', () => {
    const [seg] = parseWhisperJson(whisperOutput);
    expect(seg.start).toBe(0);
    expect(seg.end).toBe(4.9);
  });

  it('extracts word-level timings from tokens', () => {
    const [seg] = parseWhisperJson(whisperOutput);
    expect(seg.words[0]).toEqual({ word: '저는', start: 0.13, end: 0.55 });
    expect(seg.words[1].word).toBe('운동');
  });

  // whisper는 [_BEG_]와 [_TT_245] 같은 제어 토큰을 단어 사이에 섞어 낸다.
  // 거르지 않으면 자막에 그대로 찍힌다.
  it("filters whisper's special tokens", () => {
    const [seg] = parseWhisperJson(whisperOutput);
    const words = seg.words.map((w) => w.word);
    expect(words).not.toContain('[_BEG_]');
    expect(words).not.toContain('[_TT_245]');
    expect(words).toEqual(['저는', '운동', '을']);
  });

  it('trims surrounding whitespace from text', () => {
    expect(parseWhisperJson(whisperOutput)[0].text).toBe('저는 운동을 좋아해서 뛰어요.');
  });

  it('returns an empty array for malformed input', () => {
    expect(parseWhisperJson({})).toEqual([]);
    expect(parseWhisperJson(null)).toEqual([]);
  });

  it('survives a segment with no tokens at all', () => {
    const noTokens = { transcription: [{ offsets: { from: 0, to: 1000 }, text: '무음' }] };
    expect(parseWhisperJson(noTokens)[0].words).toEqual([]);
  });

  // whisper 출력 형식은 이미 세 번 우리 가정과 달랐다. 망가진 항목 하나가
  // 전체 전사를 죽이면 안 된다 — 그 실패는 잡 전체를 TypeError로 끝낸다.
  it('drops a segment missing its offsets instead of throwing', () => {
    const broken = {
      transcription: [
        { text: '멀쩡한 문장', offsets: { from: 0, to: 1000 }, tokens: [] },
        { text: 'offsets 없음' },
      ],
    };
    const parsed = parseWhisperJson(broken);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].text).toBe('멀쩡한 문장');
  });

  it('drops a segment missing its text instead of throwing', () => {
    const broken = { transcription: [{ offsets: { from: 0, to: 1000 } }] };
    expect(parseWhisperJson(broken)).toEqual([]);
  });

  it('drops a malformed token but keeps the good ones beside it', () => {
    const mixed = {
      transcription: [
        {
          text: '섞임',
          offsets: { from: 0, to: 1000 },
          tokens: [
            { text: '좋음', offsets: { from: 0, to: 400 } },
            { text: '깨짐' },
            { text: '또좋음', offsets: { from: 400, to: 900 } },
          ],
        },
      ],
    };
    expect(parseWhisperJson(mixed)[0].words.map((w) => w.word)).toEqual(['좋음', '또좋음']);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run lib/__tests__/stt.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: STT 구현**

`lib/pipeline/stt.ts`:

```ts
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import type { SubtitleJSON, SubtitleSegment } from '@studio/video/src/types';

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
      words: (seg.tokens ?? [])
        .filter(
          (token): token is WhisperToken =>
            typeof (token as WhisperToken)?.text === 'string' && hasSpan(token),
        )
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
```

`lib/pipeline/tts.ts`:

```ts
import { synthesizeFishSpeech } from '@/lib/fish-audio-client';
import path from 'node:path';

/**
 * `durationSec`는 반환하지 않는다. `synthesizeFishSpeech`의 성공 경로가 그 값을 세팅하지 않아
 * 항상 0이 되고, 0을 길이로 믿는 호출자를 만들 뿐이다. 길이는 STT 결과의 마지막 세그먼트
 * 끝시각에서 얻는다(Task 9 참조).
 */
export async function synthesizeNarration(input: {
  text: string; referenceId: string; speakingSpeed?: number; instruct?: string;
}): Promise<{ audioPath: string }> {
  const result = await synthesizeFishSpeech(input);
  if (result.status === 'error' || !result.audioUrl) {
    throw new Error(result.error ?? '음성 합성에 실패했습니다.');
  }
  return { audioPath: path.join(process.cwd(), 'public', result.audioUrl) };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run lib/__tests__/stt.test.ts
```

기대: 9개 PASS

- [ ] **Step 5: whisper가 실제로 도는지 수동 확인**

```bash
WHISPER_MODEL=<모델_절대경로>
whisper-cli -m "$WHISPER_MODEL" -l ko -ojf -of /tmp/t -f .local-data/higgsfield-pilot/00_voice_clone_reference.mp3
python3 -c "import json;d=json.load(open('/tmp/t.json'));s=d['transcription'][0];print(list(s.keys()));print(s['tokens'][:4])"
```

기대: 세그먼트 키에 `tokens`가 있고, 각 토큰에 `text`와 `offsets`가 있다. JSON이 UTF-8로 열려야 한다.
저장소에 실제 한국어 음성(`.local-data/higgsfield-pilot/00_voice_clone_reference.mp3`)이 있으니 그걸 쓴다.

- [ ] **Step 6: 커밋**

```bash
git add lib/pipeline lib/__tests__/stt.test.ts
git commit -m "feat: add TTS wrapper and whisper-based word timing extraction"
```

---

## Task 8: 스타일 시트와 씬 지시서

두 개의 독립적인 제작 사례가 같은 결론에 도달했다 — **전역 스타일 기준을 먼저 정하지 않으면 장면마다 분위기가 흩어진다.** 그래서 씬 지시서를 만들기 전에 스타일 시트를 둔다.

배경 이미지는 **온보딩에서 12장을 미리 생성해두고 씬마다 재사용**한다. 씬마다 새로 생성하면 편당 12 크레딧이 들고, 20명이 월 25편씩 만들면 월 6,000 크레딧이 된다. 라이브러리 방식은 수강생당 26 크레딧 1회로 끝난다.

LLM 실패로 전체 파이프라인이 멈추면 안 된다. 폴백은 선택이 아니라 필수다.

**Files:**
- Create: `lib/style-sheet.ts`, `lib/pipeline/scenes.ts`
- Test: `lib/__tests__/style-sheet.test.ts`, `lib/__tests__/scenes.test.ts`

**Interfaces:**
- Consumes: `SubtitleJSON`, `SceneDirective` (Task 2), `store` (Task 5)
- Produces:
  - `StyleSheet { ownerId: string; presetId: string; styleSheetUrl: string | null; palette: { accent: string; ink: string; paper: string }; toneWords: string[]; backgroundLibrary: string[] }`
  - `STYLE_PRESETS: Record<string, Omit<StyleSheet, 'ownerId' | 'backgroundLibrary' | 'styleSheetUrl'>>`
  - `getStyleSheet(ownerId: string): Promise<StyleSheet>`
  - `pickBackground(sheet: StyleSheet, sceneIndex: number): string | undefined`
  - `buildFallbackScenes(subtitles: SubtitleJSON, script: string, sheet: StyleSheet): SceneDirective[]`
  - `generateScenes(input: { script: string; subtitles: SubtitleJSON; sheet: StyleSheet }): Promise<SceneDirective[]>`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/style-sheet.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getStyleSheet, pickBackground, STYLE_PRESETS } from '../style-sheet';
import { fileStore } from '../store/file-store';

beforeEach(async () => { await fileStore.write('style-sheets', []); });

describe('STYLE_PRESETS', () => {
  it('ships at least three operator presets', () => {
    expect(Object.keys(STYLE_PRESETS).length).toBeGreaterThanOrEqual(3);
  });

  it('gives every preset a full palette', () => {
    for (const preset of Object.values(STYLE_PRESETS)) {
      expect(preset.palette.accent).toMatch(/^#/);
      expect(preset.palette.ink).toMatch(/^#/);
      expect(preset.palette.paper).toMatch(/^#/);
    }
  });
});

describe('getStyleSheet', () => {
  it('falls back to the default preset for a new student', async () => {
    const sheet = await getStyleSheet('u1');
    expect(sheet.ownerId).toBe('u1');
    expect(sheet.palette.accent).toMatch(/^#/);
    expect(sheet.backgroundLibrary).toEqual([]);
  });
});

describe('pickBackground', () => {
  const sheet = { backgroundLibrary: ['/a.png', '/b.png', '/c.png'] } as never;

  it('cycles through the library so scenes differ', () => {
    expect(pickBackground(sheet, 0)).toBe('/a.png');
    expect(pickBackground(sheet, 1)).toBe('/b.png');
    expect(pickBackground(sheet, 3)).toBe('/a.png');
  });

  it('returns undefined when the library is empty', () => {
    expect(pickBackground({ backgroundLibrary: [] } as never, 0)).toBeUndefined();
  });
});
```

`lib/__tests__/scenes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildFallbackScenes } from '../pipeline/scenes';
import { STYLE_PRESETS } from '../style-sheet';
import type { SubtitleJSON } from '@studio/video/src/types';

const sheet = {
  ownerId: 'u1', presetId: 'paper', styleSheetUrl: null,
  ...STYLE_PRESETS.paper, backgroundLibrary: ['/bg1.png'],
};

const subs: SubtitleJSON = [
  { id: 0, text: '무릎 통증', start: 0, end: 2, words: [] },
  { id: 1, text: '이렇게 잡으세요', start: 2, end: 5, words: [] },
];

describe('buildFallbackScenes', () => {
  it('produces one title card spanning the whole audio', () => {
    const scenes = buildFallbackScenes(subs, '무릎 통증 이렇게 잡으세요', sheet);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].type).toBe('title_card');
    expect(scenes[0].startTime).toBe(0);
    expect(scenes[0].endTime).toBe(5);
  });

  it('uses the opening line as the title', () => {
    expect(buildFallbackScenes(subs, '대본', sheet)[0].title).toBe('무릎 통증');
  });

  it('falls back to the script when there are no subtitles', () => {
    const scenes = buildFallbackScenes([], '무릎 통증 잡는 법', sheet);
    expect(scenes[0].title).toBe('무릎 통증 잡는 법');
    expect(scenes[0].endTime).toBeGreaterThan(0);
  });

  it('truncates a very long title', () => {
    const long = 'ㄱ'.repeat(200);
    expect(buildFallbackScenes([], long, sheet)[0].title.length).toBeLessThanOrEqual(40);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run lib/__tests__/scenes.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 스타일 시트 구현**

`lib/style-sheet.ts`:

```ts
import { store } from './store';

export interface StyleSheet {
  ownerId: string;
  presetId: string;
  styleSheetUrl: string | null;
  palette: { accent: string; ink: string; paper: string };
  toneWords: string[];
  backgroundLibrary: string[];
}

type Preset = Pick<StyleSheet, 'presetId' | 'palette' | 'toneWords'>;

export const STYLE_PRESETS: Record<string, Preset> = {
  paper: {
    presetId: 'paper',
    palette: { accent: '#c8553d', ink: '#2b2118', paper: '#f2e8d5' },
    toneWords: ['종이 질감', '컷아웃 콜라주', '빈티지 에디토리얼', '따뜻한 미색'],
  },
  studio: {
    presetId: 'studio',
    palette: { accent: '#caff00', ink: '#f4f4f0', paper: '#0d0f10' },
    toneWords: ['어두운 스튜디오', '고대비', '네온 액센트', '미니멀'],
  },
  clinic: {
    presetId: 'clinic',
    palette: { accent: '#2f80ed', ink: '#12233b', paper: '#f7fafc' },
    toneWords: ['밝고 청결', '의료 정보', '신뢰감', '차분한 블루'],
  },
  gym: {
    presetId: 'gym',
    palette: { accent: '#ff6b2c', ink: '#141414', paper: '#ededed' },
    toneWords: ['역동적', '피트니스', '강한 그림자', '오렌지 액센트'],
  },
};

const DEFAULT_PRESET = 'studio';
const KEY = 'style-sheets';

export async function getStyleSheet(ownerId: string): Promise<StyleSheet> {
  const sheets = await store.read<StyleSheet[]>(KEY, []);
  const found = sheets.find((s) => s.ownerId === ownerId);
  if (found) return found;

  return {
    ownerId,
    styleSheetUrl: null,
    backgroundLibrary: [],
    ...STYLE_PRESETS[DEFAULT_PRESET],
  };
}

export async function saveStyleSheet(sheet: StyleSheet): Promise<StyleSheet> {
  const sheets = await store.read<StyleSheet[]>(KEY, []);
  await store.write(KEY, [sheet, ...sheets.filter((s) => s.ownerId !== sheet.ownerId)]);
  return sheet;
}

/** 씬마다 다른 배경이 나오도록 라이브러리를 순환한다. 비어 있으면 배경 없이 렌더된다 */
export function pickBackground(sheet: StyleSheet, sceneIndex: number): string | undefined {
  const lib = sheet.backgroundLibrary;
  if (!lib.length) return undefined;
  return lib[sceneIndex % lib.length];
}
```

- [ ] **Step 4: 씬 지시서 구현**

`lib/pipeline/scenes.ts`:

```ts
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
```

> **온보딩에서 배경 라이브러리를 채우는 작업은 계획 2에서 한다.** 계획 1에서는
> `backgroundLibrary`가 비어 있어 배경 없이 렌더되고, 프리셋 팔레트만 적용된다.
> `pickBackground`가 `undefined`를 반환해도 씬이 정상 렌더되는지 Task 3에서 확인한다.

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run lib/__tests__/style-sheet.test.ts lib/__tests__/scenes.test.ts
```

기대: 스타일시트 5개 + 씬 4개 = 9개 PASS

- [ ] **Step 6: 커밋**

```bash
git add lib/style-sheet.ts lib/pipeline/scenes.ts lib/__tests__
git commit -m "feat: add style sheet presets and scene directive generation"
```

---

## Task 9: 엔진 인터페이스와 렌더 워커

스펙 §5의 핵심 약속인 "엔진을 갈아끼울 수 있는 구조"를 여기서 실제로 만든다. 워커가 잡의 전 생애를 소유하므로 **TTS·STT·씬생성·렌더가 모두 워커에서 돈다.** Vercel에서는 whisper를 돌릴 수 없으므로 이 배치가 필수다.

> **스펙과의 차이**: 스펙 §5는 `prepare`/`submit`/`poll` 3단계로 적혀 있으나, 워커가 잡을 소유하는 구조에서는 `produce()` 한 번으로 충분하다. Higgsfield 어댑터는 내부에서 제출·폴링을 수행하면 된다. 이 Task의 마지막에 스펙 §5를 이 형태로 갱신한다.

**Files:**
- Create: `lib/engines/types.ts`, `lib/engines/remotion.ts`, `worker/index.ts`, `worker/render.ts`, `worker/package.json`
- Modify: `docs/superpowers/specs/2026-08-26-unified-video-studio-design.md` (§5)
- Test: `worker/__tests__/loop.test.ts`, `lib/__tests__/engines.test.ts`

**Interfaces:**
- Consumes: `POST /api/jobs/next`·`PATCH /api/jobs/:id` (Task 6), `synthesizeNarration` (Task 7), `transcribeToSubtitles` (Task 7), `generateScenes` (Task 8), `ReelProps` (Task 2)
- Produces:
  - `EngineInput { projectId: string; ownerId: string; script: string; voiceReferenceId: string; outPath: string }`
  - `EngineResult { outputPath: string; durationSec: number }`
  - `EngineCapabilities { aspectRatios: string[]; maxDurationSec: number; lipSync: boolean; costModel: 'compute'|'credits'; requiresUserKey: boolean }`
  - `VideoEngine { id: EngineId; capabilities: EngineCapabilities; produce(input: EngineInput, onProgress: (pct: number) => void): Promise<EngineResult> }`
  - `remotionEngine: VideoEngine`
  - `getEngine(id: EngineId): VideoEngine`
  - `pollOnce(deps: PollDeps): Promise<'idle' | 'rendered' | 'failed'>`
  - `makeProgressReporter(report): (jobId: string) => (pct: number) => void` — 거부를 삼켜 렌더를 보호한다
  - `renderReel(props: ReelProps, outPath: string): Promise<void>`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/engines.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getEngine } from '../engines/remotion';

describe('engine registry', () => {
  it('returns the remotion engine', () => {
    expect(getEngine('remotion').id).toBe('remotion');
  });

  it('declares vertical-only, compute-cost capabilities', () => {
    const caps = getEngine('remotion').capabilities;
    expect(caps.aspectRatios).toEqual(['9:16']);
    expect(caps.costModel).toBe('compute');
    expect(caps.lipSync).toBe(false);
    expect(caps.requiresUserKey).toBe(false);
  });

  it('throws for an engine that is not implemented yet', () => {
    expect(() => getEngine('higgsfield')).toThrow(/구현되지 않은 엔진/);
  });
});
```

`worker/__tests__/loop.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { pollOnce } from '../index';

const job = { id: 'job1', projectId: 'p1', engine: 'remotion' as const };
const project = { id: 'p1', ownerId: 'u1', script: '무릎 통증 팁' };

describe('pollOnce', () => {
  it('does nothing when the queue is empty', async () => {
    const produce = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job: null, project: null }), produce, report: vi.fn(),
    });
    expect(result).toBe('idle');
    expect(produce).not.toHaveBeenCalled();
  });

  it('produces a reel and reports completion', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project }),
      produce: async () => ({ outputPath: '/out/job1.mp4', durationSec: 12 }),
      report,
    });
    expect(result).toBe('rendered');
    expect(report).toHaveBeenCalledWith('job1', {
      status: 'completed', progress: 100, resultUrl: '/out/job1.mp4',
    });
  });

  it('reports failure instead of throwing', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project }),
      produce: async () => { throw new Error('렌더 실패'); },
      report,
    });
    expect(result).toBe('failed');
    expect(report).toHaveBeenCalledWith('job1', { status: 'failed', error: '렌더 실패' });
  });

  // 진행률 보고가 거부되면 워커가 죽으면 안 된다. void 만으로는 거부를 삼키지 못한다.
  it('swallows a progress report that rejects', async () => {
    const { makeProgressReporter } = await import('../index');
    const report = vi.fn().mockRejectedValue(new Error('network blip'));
    const onProgress = makeProgressReporter(report)('job1');

    let unhandled: unknown = null;
    const onUnhandled = (reason: unknown) => { unhandled = reason; };
    process.on('unhandledRejection', onUnhandled);

    expect(() => onProgress(50)).not.toThrow();
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));

    process.off('unhandledRejection', onUnhandled);
    expect(unhandled).toBeNull();
    expect(report).toHaveBeenCalledWith('job1', { status: 'rendering', progress: 50 });
  });

  it('fails the job when the project is missing', async () => {
    const report = vi.fn();
    const result = await pollOnce({
      claim: async () => ({ job, project: null }), produce: vi.fn(), report,
    });
    expect(result).toBe('failed');
    expect(report).toHaveBeenCalledWith('job1', {
      status: 'failed', error: '프로젝트를 찾을 수 없습니다.',
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run lib/__tests__/engines.test.ts worker/__tests__/loop.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 엔진 인터페이스 정의**

`lib/engines/types.ts`:

```ts
export type EngineId = 'remotion' | 'higgsfield' | 'whiteboard';

export interface EngineCapabilities {
  aspectRatios: string[];
  maxDurationSec: number;
  lipSync: boolean;
  costModel: 'compute' | 'credits';
  requiresUserKey: boolean;
}

export interface EngineInput {
  projectId: string;
  script: string;
  voiceReferenceId: string;
  outPath: string;
}

export interface EngineResult {
  outputPath: string;
  durationSec: number;
}

export interface VideoEngine {
  id: EngineId;
  capabilities: EngineCapabilities;
  produce(input: EngineInput, onProgress: (pct: number) => void): Promise<EngineResult>;
}
```

- [ ] **Step 4: Remotion 어댑터 구현 — 전체 파이프라인이 여기 있다**

`lib/engines/remotion.ts`:

```ts
import { synthesizeNarration } from '@/lib/pipeline/tts';
import { transcribeToSubtitles } from '@/lib/pipeline/stt';
import { generateScenes } from '@/lib/pipeline/scenes';
import { getStyleSheet, pickBackground } from '@/lib/style-sheet';
import { renderReel } from '../../worker/render';
import type { EngineId, EngineInput, EngineResult, VideoEngine } from './types';

export const remotionEngine: VideoEngine = {
  id: 'remotion',
  capabilities: {
    aspectRatios: ['9:16'],
    maxDurationSec: 180,
    lipSync: false,
    costModel: 'compute',
    requiresUserKey: false,
  },

  async produce(input: EngineInput, onProgress): Promise<EngineResult> {
    onProgress(10);
    const { audioPath } = await synthesizeNarration({
      text: input.script,
      referenceId: input.voiceReferenceId,
    });

    onProgress(35);
    const subtitles = await transcribeToSubtitles(audioPath);

    onProgress(55);
    const sheet = await getStyleSheet(input.ownerId);
    const scenes = await generateScenes({ script: input.script, subtitles, sheet });
    const durationSec = subtitles.length ? subtitles[subtitles.length - 1].end : 5;

    onProgress(70);
    await renderReel(
      {
        subtitles,
        audioUrl: audioPath,
        scenes,
        durationInSeconds: durationSec,
        palette: sheet.palette,
        backgroundImageUrl: pickBackground(sheet, 0),
      },
      input.outPath,
    );

    onProgress(95);
    return { outputPath: input.outPath, durationSec };
  },
};

const REGISTRY: Partial<Record<EngineId, VideoEngine>> = { remotion: remotionEngine };

export function getEngine(id: EngineId): VideoEngine {
  const engine = REGISTRY[id];
  if (!engine) throw new Error(`구현되지 않은 엔진입니다: ${id}`);
  return engine;
}
```

- [ ] **Step 5: 워커 루프 구현**

`worker/render.ts`:

```ts
import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import path from 'node:path';
import type { ReelProps } from '@studio/video/src/types';

let bundlePromise: Promise<string> | null = null;

function getBundle(): Promise<string> {
  bundlePromise ??= bundle({
    entryPoint: path.resolve(process.cwd(), 'packages/video/src/index.ts'),
  });
  return bundlePromise;
}

export async function renderReel(props: ReelProps, outPath: string): Promise<void> {
  const serveUrl = await getBundle();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: 'ReelVertical', inputProps });
  await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: outPath, inputProps });
}
```

`worker/index.ts`:

```ts
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { getEngine } from '../lib/engines/remotion';
import type { EngineId, EngineResult } from '../lib/engines/types';

export interface ClaimedJob { id: string; projectId: string; engine: EngineId }
export interface ClaimedProject { id: string; ownerId: string; script: string }

export interface PollDeps {
  claim: () => Promise<{ job: ClaimedJob | null; project: ClaimedProject | null }>;
  produce: (job: ClaimedJob, project: ClaimedProject) => Promise<EngineResult>;
  report: (id: string, patch: Record<string, unknown>) => Promise<void> | void;
}

export async function pollOnce(deps: PollDeps): Promise<'idle' | 'rendered' | 'failed'> {
  const { job, project } = await deps.claim();
  if (!job) return 'idle';

  if (!project) {
    await deps.report(job.id, { status: 'failed', error: '프로젝트를 찾을 수 없습니다.' });
    return 'failed';
  }

  try {
    const result = await deps.produce(job, project);
    await deps.report(job.id, {
      status: 'completed', progress: 100, resultUrl: result.outputPath,
    });
    return 'rendered';
  } catch (error) {
    await deps.report(job.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

// ── 실제 폴링 루프 (WORKER_RUN=1 일 때만 동작) ──

const API = process.env.APP_URL ?? 'http://localhost:3000';
const TOKEN = process.env.WORKER_TOKEN ?? '';
const VOICE_ID = process.env.FISH_REFERENCE_ID ?? '';
const RENDER_DIR = path.join(process.cwd(), '.local-data', 'renders');
const INTERVAL_MS = 5000;

async function claimFromApi() {
  const res = await fetch(`${API}/api/jobs/next`, {
    method: 'POST', headers: { 'x-worker-token': TOKEN },
  });
  if (!res.ok) return { job: null, project: null };
  return res.json();
}

async function reportToApi(id: string, patch: Record<string, unknown>) {
  await fetch(`${API}/api/jobs/${id}`, {
    method: 'PATCH',
    headers: { 'x-worker-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

/**
 * 진행률 보고는 실패해도 렌더를 죽이면 안 된다.
 * `void`만으로는 부족하다 — 동기 예외만 막을 뿐 거부(rejection)는 그대로 새어나가고,
 * Node 기본값(`--unhandled-rejections=throw`)에서는 렌더 도중 워커가 죽는다. `.catch`가 필요하다.
 */
export function makeProgressReporter(
  report: (id: string, patch: Record<string, unknown>) => Promise<unknown>,
) {
  return (jobId: string) => (pct: number): void => {
    void report(jobId, { status: 'rendering', progress: pct }).catch(() => {});
  };
}

async function produceWithEngine(job: ClaimedJob, project: ClaimedProject) {
  await mkdir(RENDER_DIR, { recursive: true });
  return getEngine(job.engine).produce(
    {
      projectId: project.id,
      ownerId: project.ownerId,
      script: project.script,
      voiceReferenceId: VOICE_ID,
      outPath: path.join(RENDER_DIR, `${job.id}.mp4`),
    },
    makeProgressReporter(reportToApi)(job.id),
  );
}

if (process.env.WORKER_RUN === '1') {
  console.log(`[worker] ${API} 폴링 시작 (${INTERVAL_MS}ms 간격)`);
  let running = false;
  setInterval(async () => {
    if (running) return;          // 이전 렌더가 끝나기 전에 새 잡을 잡지 않는다
    running = true;
    try {
      const result = await pollOnce({
        claim: claimFromApi, produce: produceWithEngine, report: reportToApi,
      });
      if (result !== 'idle') console.log(`[worker] ${result}`);
    } catch (error) {
      console.error('[worker] 폴링 실패', error);
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
}
```

`worker/package.json`:

```json
{
  "name": "@studio/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "WORKER_RUN=1 tsx index.ts" },
  "dependencies": { "tsx": "^4.0.0" }
}
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npx vitest run lib/__tests__/engines.test.ts worker/__tests__/loop.test.ts
```

기대: 엔진 3개 + 루프 5개 = 8개 PASS

- [ ] **Step 7: 스펙 §5를 실제 인터페이스에 맞춰 갱신**

`docs/superpowers/specs/2026-08-26-unified-video-studio-design.md`의 §5 코드 블록을 `prepare`/`submit`/`poll`에서 `produce(input, onProgress)` 형태로 바꾸고, 워커가 잡 생애를 소유하므로 이 형태가 된다는 한 문장을 덧붙인다.

- [ ] **Step 9: 커밋**

```bash
git add lib/engines worker docs/superpowers/specs
git commit -m "feat: add engine interface and pull-based render worker"
```

---

## Task 10: 초대코드 인증

**Files:**
- Create: `lib/auth.ts`, `app/api/auth/route.ts`
- Test: `lib/__tests__/auth.test.ts`

**Interfaces:**
- Consumes: `store` (Task 5)
- Produces:
  - `hashCode(code: string): string`
  - `verifyInviteCode(code: string): Promise<StudentAccount | null>`
  - `signSession(studentId: string): string` — `SESSION_SECRET` 미설정 시 예외
  - `readSession(value: string | undefined | null): string | null` — 서명이 맞을 때만 id 반환, 비밀값 없으면 항상 null
  - `StudentAccount { id: string; name: string; codeHash: string; monthlyRenderCount: number; createdAt: string }`
  - `POST /api/auth` — 본문 `{ code }`. 200 시 `student_session` 쿠키 설정

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { hashCode, verifyInviteCode, signSession, readSession } from '../auth';
import { fileStore } from '../store/file-store';

beforeEach(async () => {
  await fileStore.write('students', [
    { id: 'u1', name: '수강생1', codeHash: hashCode('ABC123'), monthlyRenderCount: 0, createdAt: '2026-08-26T00:00:00Z' },
  ]);
});

describe('verifyInviteCode', () => {
  it('accepts a valid code', async () => {
    expect((await verifyInviteCode('ABC123'))?.id).toBe('u1');
  });

  it('rejects an unknown code', async () => {
    expect(await verifyInviteCode('WRONG')).toBeNull();
  });

  it('is case insensitive', async () => {
    expect((await verifyInviteCode('abc123'))?.id).toBe('u1');
  });

  it('rejects an empty code', async () => {
    expect(await verifyInviteCode('')).toBeNull();
  });
});

describe('hashCode', () => {
  it('never stores the raw code', () => {
    expect(hashCode('ABC123')).not.toContain('ABC123');
  });
});

// 서명이 없으면 세션 쿠키는 인증이 아니라 자기신고다.
describe('session signing', () => {
  beforeEach(() => { process.env.SESSION_SECRET = 'test-secret'; });

  it('round-trips a signed session', () => {
    expect(readSession(signSession('u1'))).toBe('u1');
  });

  it('rejects a bare student id with no signature', () => {
    expect(readSession('u1')).toBeNull();
  });

  it('rejects a tampered student id', () => {
    const signed = signSession('u1');
    const forged = signed.replace(/^u1\./, 'u2.');
    expect(readSession(forged)).toBeNull();
  });

  it('rejects a tampered signature', () => {
    const signed = signSession('u1');
    expect(readSession(`${signed.slice(0, -1)}0`)).toBeNull();
  });

  it('rejects a signature made with a different secret', () => {
    const signed = signSession('u1');
    process.env.SESSION_SECRET = 'other-secret';
    expect(readSession(signed)).toBeNull();
  });

  it('fails closed when SESSION_SECRET is unset', () => {
    const signed = signSession('u1');
    delete process.env.SESSION_SECRET;
    expect(readSession(signed)).toBeNull();
  });

  it('returns null for a missing cookie', () => {
    expect(readSession(undefined)).toBeNull();
    expect(readSession('')).toBeNull();
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run lib/__tests__/auth.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`lib/auth.ts`:

```ts
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { store } from './store';

export interface StudentAccount {
  id: string; name: string; codeHash: string; monthlyRenderCount: number; createdAt: string;
}

export function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * 세션 쿠키에 학생 id를 그냥 담으면 인증이 아니라 자기신고가 된다 —
 * 누구든 `student_session=u1`을 보내면 그 학생이 된다. httpOnly는 JS 읽기만 막을 뿐
 * curl이나 devtools로 값을 넣는 걸 막지 못한다. 그래서 서명한다.
 */
function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? '';
}

export function signSession(studentId: string): string {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error('SESSION_SECRET이 설정되지 않았습니다. 세션에 서명할 수 없습니다.');
  }
  const mac = createHmac('sha256', secret).update(studentId).digest('hex');
  return `${studentId}.${mac}`;
}

/** 서명이 맞을 때만 학생 id를 돌려준다. 비밀값이 없으면 아무도 통과시키지 않는다. */
export function readSession(value: string | undefined | null): string | null {
  const secret = sessionSecret();
  if (!value || !secret) return null;

  const cut = value.lastIndexOf('.');
  if (cut <= 0 || cut === value.length - 1) return null;

  const id = value.slice(0, cut);
  const given = Buffer.from(value.slice(cut + 1), 'utf8');
  const expected = Buffer.from(
    createHmac('sha256', secret).update(id).digest('hex'),
    'utf8',
  );

  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? id : null;
}

export async function verifyInviteCode(code: string): Promise<StudentAccount | null> {
  if (!code?.trim()) return null;
  const students = await store.read<StudentAccount[]>('students', []);
  const target = hashCode(code);
  return students.find((s) => s.codeHash === target) ?? null;
}
```

`app/api/auth/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { signSession, verifyInviteCode } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const { code } = (await request.json()) as { code?: string };
  const student = await verifyInviteCode(code ?? '');
  if (!student) {
    return NextResponse.json({ error: '초대코드가 올바르지 않습니다.' }, { status: 401 });
  }
  const res = NextResponse.json({ id: student.id, name: student.name });
  res.cookies.set('student_session', signSession(student.id), {
    httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run lib/__tests__/auth.test.ts
```

기대: 12개 PASS

- [ ] **Step 5: 커밋**

```bash
git add lib/auth.ts app/api/auth lib/__tests__/auth.test.ts
git commit -m "feat: add invite code authentication"
```

---

## Task 11: 프로젝트 생성 API와 사용량 제한

**Files:**
- Create: `app/api/projects/route.ts`
- Modify: `lib/projects.ts` (사용량 제한 추가), `app/api/video/generate/route.ts` (삭제), `app/page.tsx` (새 API 연결)
- Test: `lib/__tests__/usage-limit.test.ts`

**Interfaces:**
- Consumes: `createProject` (Task 5), `enqueueJob` (Task 5), `StudentAccount` (Task 10)
- Produces:
  - `canRender(student: StudentAccount): boolean`
  - `MONTHLY_RENDER_LIMIT = 30`
  - `POST /api/projects` — 쿠키 `student_session` 필요. 200 `{ projectId, jobId, status: 'queued' }`, 401 미인증, 429 한도초과, 400 대본 문제

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/usage-limit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { canRender, MONTHLY_RENDER_LIMIT } from '../projects';
import type { StudentAccount } from '../auth';

const student = (count: number): StudentAccount => ({
  id: 'u1', name: '수강생1', codeHash: 'x',
  monthlyRenderCount: count, createdAt: '2026-08-26T00:00:00Z',
});

describe('canRender', () => {
  it('allows a student under the limit', () => {
    expect(canRender(student(0))).toBe(true);
    expect(canRender(student(MONTHLY_RENDER_LIMIT - 1))).toBe(true);
  });

  it('blocks a student at the limit', () => {
    expect(canRender(student(MONTHLY_RENDER_LIMIT))).toBe(false);
  });

  it('blocks a student past the limit', () => {
    expect(canRender(student(MONTHLY_RENDER_LIMIT + 5))).toBe(false);
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run lib/__tests__/usage-limit.test.ts
```

기대: FAIL — `canRender`가 없음

- [ ] **Step 3: 구현**

`lib/projects.ts`에 **추가**한다 (파일 자체는 Task 5에서 생성됨):

```ts
import type { StudentAccount } from './auth';

export const MONTHLY_RENDER_LIMIT = 30;

export function canRender(student: StudentAccount): boolean {
  return student.monthlyRenderCount < MONTHLY_RENDER_LIMIT;
}
```

`app/api/projects/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createProject, canRender, MONTHLY_RENDER_LIMIT } from '@/lib/projects';
import { enqueueJob } from '@/lib/jobs';
import { store } from '@/lib/store';
import { readSession, type StudentAccount } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const ownerId = readSession((await cookies()).get('student_session')?.value);
  if (!ownerId) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  const students = await store.read<StudentAccount[]>('students', []);
  const student = students.find((s) => s.id === ownerId);
  if (!student) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });

  if (!canRender(student)) {
    return NextResponse.json(
      { error: `이번 달 생성 한도(${MONTHLY_RENDER_LIMIT}편)를 모두 사용했습니다.` },
      { status: 429 },
    );
  }

  const { script } = (await request.json()) as { script?: string };
  if (!script?.trim()) {
    return NextResponse.json({ error: '대본을 입력해주세요.' }, { status: 400 });
  }
  if (script.length > 1500) {
    return NextResponse.json({ error: '대본은 최대 1500자까지 입력할 수 있습니다.' }, { status: 400 });
  }

  const project = await createProject({ ownerId, script });
  const job = await enqueueJob({ projectId: project.id, ownerId });

  await store.write('students', students.map((s) =>
    s.id === ownerId ? { ...s, monthlyRenderCount: s.monthlyRenderCount + 1 } : s));

  return NextResponse.json({ projectId: project.id, jobId: job.id, status: 'queued' });
}
```

- [ ] **Step 4: UI를 새 엔드포인트로 재배선**

`app/page.tsx`(1,439줄)는 HeyGen 시절 흐름으로 짜여 있다. **UI를 재구성하지 않는다** — 호출 대상만
바꾸고, 새 파이프라인에 맞지 않는 차단 조건을 푼다. 화면 정리는 계획 2의 일이다.

바꿀 것은 셋뿐이다:

1. **생성 요청**: `generateVideo()`의 `fetch('/api/video/generate', ...)`를
   `fetch('/api/projects', { method:'POST', headers:{'Content-Type':'application/json'},
   body: JSON.stringify({ script }) })`로 교체한다. 응답은 `{ projectId, jobId, status }`다.
   TTS를 앱에서 먼저 부르던 블록(`/api/voicebox/generate` 호출)은 **제거한다** — 이제 워커가
   파이프라인 전체를 돌린다.

2. **진행률 폴링**: `pollVideoStatus()`의 `fetch(\`/api/video/status/${'$'}{nextJobId}\`)`를
   `fetch(\`/api/jobs/${'$'}{nextJobId}\`)`로 바꾼다. 응답 형태는
   `{ status, progress, resultUrl, error }`이므로 `data.videoUrl` 참조를 `data.resultUrl`로 고친다.

3. **차단 조건 완화**: Remotion 경로는 아바타 사진도 목소리 등록도 필요 없다. `generateVideo()`
   앞부분의 `!avatar.id` / `!hasVoiceInput` 조기 반환을 제거한다. 대본만 있으면 생성되어야 한다.
   업로드 UI 자체는 그대로 둔다(계획 2에서 캐릭터 에셋으로 재사용).

429(한도 초과)와 401(미인증) 응답은 `data.error`를 그대로 `setMessage()`로 보여준다.

> **인증 UI는 이 Task가 아니다.** 초대코드 입력 화면은 Task 12에서 만든다. 지금은 쿠키가 없으면
> `/api/projects`가 401을 반환하고 그 문구가 화면에 뜨는 것까지가 정상이다.

- [ ] **Step 5: HeyGen 라우트와 죽은 코드 삭제**

`app/page.tsx`가 더 이상 이것들을 호출하지 않는 것을 확인한 뒤에 지운다.

```bash
git rm app/api/video/generate/route.ts app/api/video/status/\[jobId\]/route.ts
git rm app/api/avatar/create/route.ts app/api/voice/clone/route.ts
git rm lib/mock-jobs.ts lib/voicebox-client.ts
git rm -r app/reels
```

- [ ] **Step 6: 테스트 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

기대: 전체 PASS. 타입 에러가 있으면 삭제한 모듈을 참조하는 곳을 고친다.

- [ ] **Step 7: 커밋**

```bash
git add -A
git commit -m "feat: add project API with usage limit and remove HeyGen mock routes"
```

---

## Task 12: 배포와 수강생 접속 확인

**Files:**
- Create: `lib/store/blob-store.ts`, `app/login/page.tsx`
- Modify: `app/globals.css` (로그인 화면 스타일), `app/page.tsx` (401 → /login), `lib/store/index.ts` (구현체 선택 추가), `.env.example`, `lib/store/file-store.ts` (`kind` 추가)
- Test: `lib/__tests__/store-select.test.ts`

**Interfaces:**
- Consumes: 모든 이전 Task
- Produces:
  - `selectStore(): Store & { kind: 'file' | 'blob' }`
  - `store` — 환경에 따라 선택된 싱글턴
  - 수강생이 접속 가능한 URL

- [ ] **Step 1: 환경변수 정리**

`.env.example`을 다음으로 교체한다:

```
# Fish Audio TTS
FISH_API_KEY=
FISH_TTS_MODEL=s2.1-pro-free
FISH_REFERENCE_ID=

# 세션 서명
SESSION_SECRET=

# 렌더 워커
WORKER_TOKEN=
APP_URL=http://localhost:3000
WHISPER_MODEL=ggml-base.bin

# 저장소
STORE_DIR=
```

- [ ] **Step 2: 로컬 전 구간 통과 확인**

터미널 두 개로:

```bash
# 터미널 1
npm run dev

# 터미널 2
WORKER_RUN=1 WORKER_TOKEN=<토큰> APP_URL=http://localhost:3000 npx tsx worker/index.ts
```

브라우저에서 초대코드 입력 → 대본 입력 → 생성. 워커 로그에 잡이 잡히고 `.local-data/renders/`에 MP4가 생기는지 확인한다.

- [ ] **Step 3: 초대코드 로그인 화면**

Task 10이 `POST /api/auth`를 만들었지만 **화면이 없다.** 수강생이 코드를 넣을 곳이 필요하다.

`app/login/page.tsx`:

```tsx
'use client';

import { useState } from 'react';

export default function LoginPage() {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? '초대코드를 확인해주세요.');
        return;
      }
      window.location.href = '/';
    } catch {
      setError('접속에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="loginShell">
      <form className="loginCard" onSubmit={submit}>
        <h1>오토사장</h1>
        <p>수강생 초대코드를 입력해주세요.</p>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="초대코드"
          autoComplete="off"
          aria-label="초대코드"
        />
        <button type="submit" disabled={busy || !code.trim()}>
          {busy ? '확인 중…' : '시작하기'}
        </button>
        {error && <p className="loginError">{error}</p>}
      </form>
    </main>
  );
}
```

`app/globals.css` 맨 아래에 최소 스타일을 더한다 — 기존 토큰(`--bg`, `--panel`, `--ink`,
`--acid`, `--line`)을 쓰고 새 색을 만들지 않는다:

```css
.loginShell { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
.loginCard { display: flex; flex-direction: column; gap: 16px; width: min(360px, 100%);
  padding: 32px; background: var(--panel); border: 1px solid var(--line); border-radius: 16px; }
.loginCard h1 { margin: 0; font-size: 28px; }
.loginCard p { margin: 0; color: var(--muted); font-size: 14px; }
.loginCard input { padding: 12px 14px; border-radius: 10px; border: 1px solid var(--line-strong);
  background: var(--panel-2); color: var(--ink); }
.loginCard button { padding: 12px 14px; border-radius: 10px; border: 0;
  background: var(--acid); color: var(--bg); font-weight: 700; cursor: pointer; }
.loginCard button:disabled { opacity: .5; cursor: default; }
.loginError { color: var(--pink); font-size: 13px; }
```

그리고 `app/page.tsx`에서 `/api/projects`가 401을 반환하면 `/login`으로 보낸다:

```ts
      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }
```

- [ ] **Step 4: 초대코드 발급**

`.local-data/students.json`에 수강생 계정을 만든다. 코드는 `hashCode()`로 해시해서 넣는다.

```bash
node -e "
const {createHash}=require('crypto');
const h=c=>createHash('sha256').update(c.trim().toUpperCase()).digest('hex');
console.log(JSON.stringify([
  {id:'u1',name:'테스트수강생',codeHash:h('TEST01'),monthlyRenderCount:0,createdAt:new Date().toISOString()}
],null,2));
" > .local-data/students.json
```

- [ ] **Step 5: Blob 저장소 구현 — 이 Task의 실질적인 작업**

**Vercel의 파일시스템은 쓰기가 되지 않는다.** `fileStore`는 로컬에서만 동작하므로 배포용 구현체가 필요하다.

먼저 실패하는 테스트를 쓴다. `lib/__tests__/store-select.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { selectStore } from '../store';

beforeEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe('selectStore', () => {
  it('uses the file store when no blob token is set', () => {
    expect(selectStore().kind).toBe('file');
  });

  it('uses the blob store when a token is present', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_x';
    expect(selectStore().kind).toBe('blob');
  });
});
```

```bash
npx vitest run lib/__tests__/store-select.test.ts   # FAIL 확인
npm install @vercel/blob
```

`lib/store/blob-store.ts`:

```ts
import { put, list } from '@vercel/blob';
import type { Store } from './types';

export const blobStore: Store & { kind: 'blob' } = {
  kind: 'blob',

  async read<T>(key: string, fallback: T): Promise<T> {
    try {
      const { blobs } = await list({ prefix: `${key}.json`, limit: 1 });
      if (!blobs.length) return fallback;
      const res = await fetch(blobs[0].url, { cache: 'no-store' });
      if (!res.ok) return fallback;
      return (await res.json()) as T;
    } catch {
      return fallback;
    }
  },

  async write<T>(key: string, value: T): Promise<void> {
    await put(`${key}.json`, JSON.stringify(value, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  },
};
```

`lib/store/index.ts`를 **교체**한다 (Task 5에서 만든 단순 버전을 구현체 선택으로 확장):

```ts
import { fileStore } from './file-store';
import { blobStore } from './blob-store';
import type { Store } from './types';

export function selectStore(): Store & { kind: 'file' | 'blob' } {
  return process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore;
}

export const store = selectStore();
```

`lib/store/file-store.ts`의 `fileStore`에 `kind: 'file' as const`를 추가한다.

소비 코드는 이미 전부 `store`를 쓰고 있으므로 **더 고칠 곳이 없다** (Task 5의 Global Constraints 준수 덕분).

```bash
npx vitest run   # 전체 통과 확인
```

> **알려진 한계 — 동시 쓰기 경합**: 이 저장소는 읽기-수정-쓰기 방식이라 두 요청이 동시에 같은 키를 쓰면 한쪽이 덮인다. 수강생 20명·워커 1대 규모에서는 발생 확률이 낮지만 실재하는 결함이다. 프로젝트 생성이 유실되는 사례가 관측되면 Postgres(Vercel Postgres 또는 Supabase)로 교체한다. `Store` 인터페이스 뒤에 있으므로 교체 범위는 이 파일 하나다.

- [ ] **Step 6: Vercel 배포**

```bash
npx vercel --prod
```

Vercel 프로젝트 설정에 등록할 환경변수:

| 변수 | 값 |
|---|---|
| `FISH_API_KEY` | Fish Audio 키 |
| `FISH_REFERENCE_ID` | 클론 보이스 모델 ID |
| `SESSION_SECRET` | 세션 쿠키 서명 키 — **없으면 `POST /api/auth`가 전원 500이다** |
| `WORKER_TOKEN` | 워커와 공유할 난수 문자열 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob 연결 시 자동 주입 |

`SESSION_SECRET`과 `WORKER_TOKEN`은 각각 다음으로 만든다(서로 다른 값을 쓴다):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 6-2: 수강생 초대코드 발급**

`.local-data/students.json`은 로컬 파일 저장소에서만 읽힌다. 배포는 Blob 저장소를 고르므로
파일을 편집해봐야 배포된 앱에서는 모든 초대코드가 거부된다. 선택된 저장소에 쓰는 스크립트를 쓴다:

```bash
# 로컬
npx tsx scripts/seed-student.ts "홍길동"

# 배포(Blob)
BLOB_READ_WRITE_TOKEN=<토큰> npx tsx scripts/seed-student.ts "홍길동"
```

출력된 초대코드를 수강생에게 전달한다. 코드 원문은 저장되지 않고 해시만 보관된다.

- [ ] **Step 7: 워커를 배포된 앱에 연결**

```bash
WORKER_RUN=1 WORKER_TOKEN=<토큰> APP_URL=https://<배포주소> npx tsx worker/index.ts
```

맥에서 상시 실행되도록 `launchd` 또는 `pm2`로 등록한다.

- [ ] **Step 8: 수강생 1명으로 실제 확인**

배포 주소에 초대코드로 접속해서 릴스 1편을 끝까지 만든다. 실패하면 원인을 기록하고 고친다.

- [ ] **Step 8: 커밋**

```bash
git add -A
git commit -m "feat: add deployment configuration and blob store"
```

---

## 완료 조건

- [ ] 수강생이 초대코드로 접속해 대본을 입력하면 1080×1920 MP4가 생성된다
- [ ] 자막이 단어 단위로 강조된다
- [ ] 생성 실패 시 한국어 문구로 원인이 표시된다
- [ ] 워커를 껐다 켜도 큐에 쌓인 작업이 처리된다
- [ ] 월 생성 한도 초과 시 안내가 나온다
- [ ] `npx vitest run`과 `npx tsc --noEmit`이 통과한다

## 계획 2로 미루는 것

씬 5종 추가(`content_slide`·`emphasis`·`list_reveal`·`quote`·`conclusion`) · LLM 씬 지시서 생성 · Rive 캐릭터 리깅과 연동 · `learning-store` 표본 문턱 · 캐릭터 PNG 폴백 컴포넌트
