import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GET } from '@/app/api/clipart/route';
import { signSession } from '@/lib/auth';
import { catalogFor } from '@/lib/clipart-store';
import { presetDir } from '@/lib/clipart-preset';

/**
 * **앱과 워커는 같은 카탈로그를 봐야 한다.**
 *
 * 이 파일이 있는 이유는 실측 실패다(`task-7-report.md`의 F1). 앱은 Vercel에서, 워커는
 * 운영자 맥에서 돈다. 예전에는 양쪽이 각자 `CLIPART_PRESET_DIR`의 `assets/catalog.json`을
 * 읽었고, 배포에서 앱에는 그 디렉터리가 없다. 그래서 앱은 수강생에게
 * `{"entries":[],"usingPreset":true}`라고 답해 "어떤 낱말이 캐릭터를 부르는지" 하나도
 * 못 알려 주는데, 워커는 자기 디스크의 카탈로그로 **같은 릴스에 운영자 캐릭터 세 개를
 * 넣었다.** 수강생은 캐릭터가 나온다는 사실조차 모른 채 남의 얼굴이 든 릴스를 받는다.
 *
 * 그래서 아래 두 검사는 **각 쪽이 실제로 쓰는 경로 그대로** 카탈로그를 읽는다:
 * 앱은 `GET /api/clipart`(수강생 화면이 읽는 그 라우트), 워커는 `catalogFor`
 * (`lib/engines/remotion.ts`의 `characterCatalog`가 부르는 그 함수). 그리고 배포 상태를
 * 흉내 낸다 — 앱 쪽 `CLIPART_PRESET_DIR`는 없는 경로, 워커 쪽은 실제로 존재하는 디렉터리.
 */

/** 아직 아무것도 안 올린 수강생. 프리셋으로 떨어지는 유일한 조건이다. */
const NEW_STUDENT = 'u-no-uploads';

/** 배포된 앱의 상태: 프리셋 디렉터리가 아예 없는 기계. */
function asDeployedApp(): void {
  process.env.CLIPART_PRESET_DIR = path.join(os.tmpdir(), 'no-preset-dir-' + Date.now());
}

/**
 * 워커 기계의 상태: 디렉터리가 실제로 있다. **미끼를 심는다** — 디스크의 카탈로그에만 있는
 * 키워드를 넣어 두고, 그게 결과에 나타나면 아직 파일시스템을 읽고 있다는 뜻이다.
 */
const DECOY = '디스크에만있는키워드';

function asWorkerMachine(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'worker-preset-'));
  mkdirSync(path.join(dir, 'assets', 'clipart'), { recursive: true });
  writeFileSync(path.join(dir, 'assets', 'catalog.json'), JSON.stringify({
    items: [{
      keyword: DECOY, aliases: [], category: '감정',
      file: `assets/clipart/${DECOY}.png`, status: 'ready',
    }],
  }));
  process.env.CLIPART_PRESET_DIR = dir;
  return dir;
}

async function appKeywords(): Promise<string[]> {
  const res = await GET(new Request('http://localhost/api/clipart', {
    headers: { Cookie: `student_session=${signSession(NEW_STUDENT)}` },
  }));
  const body = await res.json() as { entries: { keyword: string }[]; usingPreset: boolean };
  expect(body.usingPreset).toBe(true);
  return body.entries.map((e) => e.keyword);
}

async function workerKeywords(): Promise<string[]> {
  const { entries } = await catalogFor(NEW_STUDENT);
  return entries.map((e) => e.keyword);
}

beforeEach(() => { process.env.SESSION_SECRET = 'test-secret'; });

describe('앱과 워커가 보는 프리셋 카탈로그', () => {
  it('is the same keyword set on both sides in the deployed split', async () => {
    asDeployedApp();
    const fromApp = await appKeywords();

    asWorkerMachine();
    const fromWorker = await workerKeywords();

    // 빈 집합끼리 같은 것은 이 검사가 잡으려던 상태가 아니다. 실제로 카탈로그가 있어야 한다.
    expect(fromApp.length).toBeGreaterThan(100);
    expect(new Set(fromApp)).toEqual(new Set(fromWorker));
  });

  it('never lets the worker disk decide what the catalog contains', async () => {
    const dir = asWorkerMachine();
    expect(presetDir()).toBe(dir);
    expect(await workerKeywords()).not.toContain(DECOY);

    asDeployedApp();
    expect(await appKeywords()).not.toContain(DECOY);
  });

  /**
   * 앱은 프리셋 디렉터리가 없어도 칩에 띄울 낱말을 갖는다 — 이게 F1이 고쳐졌다는 뜻이다.
   * 예전에는 여기서 `[]`가 나왔고, 안내는 "기본 캐릭터가 들어갑니다"라고만 말한 채
   * 무엇이 캐릭터를 부르는지는 끝내 알려 주지 못했다.
   */
  it('gives the deployed app the keywords the student needs to see', async () => {
    asDeployedApp();
    const fromApp = await appKeywords();
    expect(fromApp).toContain('걱정');
    expect(fromApp).toContain('건강');
  });

  /**
   * 그림 바이트는 여전히 워커 디스크에 있다. 나뉘는 지점은 여기다: 메타데이터는 커밋본,
   * 바이트는 `presetDir()` + 항목의 `file`. 그래서 `file`은 절대 경로가 되면 안 된다.
   */
  it('keeps every path resolvable against the worker preset directory', async () => {
    asWorkerMachine();
    const { entries } = await catalogFor(NEW_STUDENT);
    expect(entries.every((e) => e.file.startsWith('assets/'))).toBe(true);
    expect(entries.every((e) => !path.isAbsolute(e.file))).toBe(true);
  });
});
