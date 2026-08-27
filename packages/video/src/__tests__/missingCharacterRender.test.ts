import { describe, it, expect, beforeAll } from 'vitest';
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FALLBACK_PALETTE } from '../types';
import type { ReelProps, SceneDirective } from '../types';

/**
 * **실제로 렌더한다.** 이 파일만 헤드리스 크롬을 띄우고, 그럴 만한 이유가 있다.
 *
 * 캐릭터 그림이 없을 때 릴스가 살아남는지는 마크업으로는 증명할 수 없다. 중단을 부르는
 * 코드가 우리 것이 아니라 Remotion `<Img>` 안에 있고(404 → 두 번 재시도 → `cancelRender`),
 * 다른 검사들은 그 `<Img>`를 평범한 `<img>`로 모킹해 두었기 때문이다. 모킹한 것으로는
 * 모킹한 동작만 확인된다.
 *
 * "헬퍼가 resolve한다"를 확인하는 검사는 이 보장을 증명하지 못한다 — 요구사항은 헬퍼가
 * 예외를 던지지 않는 것이 아니라 **렌더가 살아남는 것**이었다.
 *
 * 비용은 프레임 하나 × 3회다(≈5초). 번들·크롬은 `worker/render.ts`가 이미 쓰는 것과 같다.
 */

/** 1x1 불투명 PNG. 캐릭터가 실제로 그려지는지 보기 위한 표본이라 투명하면 안 된다. */
const OPAQUE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGO4I2LzHwAFKAIsEAh12wAAAABJRU5ErkJggg==',
  'base64',
);

const PRESENT = 'clipart/present.png';
/** 복사되지 못한 프리셋, 또는 404가 난 수강생 Blob URL이 씬에 남았을 때의 모양 */
const MISSING = 'clipart/never-copied.png';

const scene = (characterImageUrl?: string): SceneDirective => ({
  type: 'title_card', startTime: 0, endTime: 2, title: '제목', characterImageUrl,
});

const propsFor = (characterImageUrl?: string): ReelProps => ({
  subtitles: [],
  audioUrl: null,
  scenes: [scene(characterImageUrl)],
  durationInSeconds: 2,
  palette: FALLBACK_PALETTE,
});

let serveUrl: string;
let outDir: string;

/**
 * public 루트를 빈 임시 디렉터리로 준다 — 저장소의 `public/`에 우연히 같은 이름의 파일이
 * 있어서 검사가 통과하는 일이 없도록. 번들 설정은 `worker/render.ts`의 `getBundle`과 같다.
 */
beforeAll(async () => {
  const publicDir = mkdtempSync(path.join(os.tmpdir(), 'render-public-'));
  mkdirSync(path.join(publicDir, 'clipart'), { recursive: true });
  writeFileSync(path.join(publicDir, PRESENT), OPAQUE_PIXEL_PNG);
  outDir = mkdtempSync(path.join(os.tmpdir(), 'render-out-'));

  serveUrl = await bundle({
    entryPoint: path.resolve(process.cwd(), 'packages/video/src/index.ts'),
    publicDir,
    symlinkPublicDir: true,
  });
}, 300_000);

async function renderFrame(name: string, characterImageUrl?: string): Promise<Buffer> {
  const inputProps = propsFor(characterImageUrl) as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: 'ReelVertical', inputProps });
  const output = path.join(outDir, `${name}.png`);
  await renderStill({
    composition, serveUrl, inputProps,
    // 씬 한가운데 프레임. 등장 모션이 끝나 캐릭터가 제자리에 있다.
    frame: 20,
    output,
    logLevel: 'error',
    // 404와 재시도 경고는 이 검사가 **일부러 만든 상황**이다. 그대로 흘리면 통과한 실행이
    // 빨간 stderr로 뒤덮여, 진짜 실패를 알아보지 못하게 된다.
    onBrowserLog: () => {},
  });
  return readFileSync(output);
}

describe('렌더는 캐릭터 그림이 없어도 살아남는다', () => {
  /**
   * 없는 그림을 가리키는 씬. `CharacterImage`의 `onError`가 없으면 Remotion이
   * `cancelRender('Error loading image with src: …')`로 렌더를 중단한다 — 실제로 그렇게
   * 죽는 것을 확인한 뒤 이 검사를 붙였다.
   */
  it('still produces a frame when the character image is a 404', async () => {
    const frame = await renderFrame('missing', MISSING);
    expect(frame.length).toBeGreaterThan(0);
  }, 300_000);

  /**
   * 위 검사가 공허하지 않으려면 이 하네스가 캐릭터를 **실제로 그려야** 한다. 컴포지션이
   * `characterImageUrl`을 통째로 무시해도 위 검사는 통과하기 때문이다.
   */
  it('actually draws a character when the image is there', async () => {
    const [withCharacter, without] = await Promise.all([
      renderFrame('present', PRESENT),
      renderFrame('none', undefined),
    ]);
    expect(withCharacter.equals(without)).toBe(false);
  }, 300_000);

  /**
   * 그리고 실패한 캐릭터는 **깨끗이** 빠져야 한다. 반쯤 그려진 자리(깨진 이미지 아이콘,
   * 빈 상자)가 남으면 릴스에 그대로 박힌다. 없는 그림으로 렌더한 프레임이 캐릭터를 아예
   * 배정하지 않은 프레임과 바이트까지 같아야 그게 참이다.
   */
  it('leaves no trace of the character it could not load', async () => {
    const [missing, none] = await Promise.all([
      renderFrame('missing2', MISSING),
      renderFrame('none2', undefined),
    ]);
    expect(missing.equals(none)).toBe(true);
  }, 300_000);
});
