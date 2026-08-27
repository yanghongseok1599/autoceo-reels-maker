import { describe, it, expect, beforeAll } from 'vitest';
import { bundle } from '@remotion/bundler';
import { renderFrames, renderStill, selectComposition } from '@remotion/renderer';
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

/**
 * 위 세 검사는 **씬 하나**를 `renderStill`로 찍는다. 그 하네스는 프레임마다 페이지를 새로
 * 열기 때문에 컴포넌트 상태가 프레임 사이에 남지 않는다 — 그래서 "한 번 실패한 캐릭터가
 * **다음 씬의 멀쩡한 캐릭터까지** 지운다"는 고장을 볼 수가 없다.
 *
 * 실제 릴스는 그렇게 렌더되지 않는다. `worker/render.ts`의 `renderMedia`는 한 페이지에서
 * 프레임을 이어서 찍고, `SceneRouter`는 씬이 바뀌어도 같은 자리에 `<CharacterImage>`를
 * 그리므로 React가 **컴포넌트 인스턴스를 재사용한다**. 인스턴스가 살아 있으면 실패 표시도
 * 같이 산다. 그래서 아래는 `renderFrames`로 여러 씬을 한 번에 이어 찍고, **뒤 씬 안쪽**
 * 프레임을 표본으로 본다.
 *
 * 이 모양은 드문 조합이 아니다. Task 7에서 실제로 확인한 릴이 정확히 이것이었다 —
 * `content_slide` → `content_slide`에 서로 다른 캐릭터.
 */
const SCENE_SECONDS = 2;
/** 뒤 씬 안쪽(t≈3.33s) 프레임. 등장 모션(0.5s)이 끝나 캐릭터가 제자리에 있다. */
const SAMPLE_FRAME = 100;

function twoScenes(first: string | undefined, second: string | undefined): ReelProps {
  const slide = (at: number, heading: string, characterImageUrl?: string): SceneDirective => ({
    type: 'content_slide',
    startTime: at * SCENE_SECONDS,
    endTime: (at + 1) * SCENE_SECONDS,
    heading,
    bullets: ['한 줄'],
    characterImageUrl,
  });
  return {
    subtitles: [],
    audioUrl: null,
    scenes: [slide(0, '첫째 장면', first), slide(1, '둘째 장면', second)],
    durationInSeconds: SCENE_SECONDS * 2,
    palette: FALLBACK_PALETTE,
  };
}

/**
 * 프레임 0부터 `SAMPLE_FRAME`까지를 **한 페이지에서 이어서** 렌더하고 그 마지막 프레임을
 * 돌려준다. `concurrency: 1`이 핵심이다 — 페이지가 하나여야 앞 씬에서 생긴 상태가 뒤 씬으로
 * 넘어간다. 여러 페이지로 나누면 이 검사가 보려는 것이 우연히 사라진다.
 */
async function sampleAfterTwoScenes(props: ReelProps): Promise<Buffer> {
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: 'ReelVertical', inputProps });
  const sampled: Buffer[] = [];
  await renderFrames({
    composition,
    serveUrl,
    inputProps,
    // `onFrameBuffer`를 쓰면 디스크를 거치지 않는다. 표본 한 장만 들고 나머지는 흘린다.
    outputDir: null,
    imageFormat: 'png',
    frameRange: [0, SAMPLE_FRAME],
    concurrency: 1,
    onFrameBuffer: (buffer, frame) => {
      if (frame === SAMPLE_FRAME) sampled.push(Buffer.from(buffer));
    },
    onStart: () => {},
    onFrameUpdate: () => {},
    logLevel: 'error',
    onBrowserLog: () => {},
  });
  const frame = sampled[0];
  if (!frame) throw new Error(`프레임 ${SAMPLE_FRAME}이 렌더되지 않았다`);
  return frame;
}

describe('앞 씬에서 실패한 캐릭터가 뒤 씬의 캐릭터를 데려가지 않는다', () => {
  let earlierNone: Buffer;
  let earlierMissing: Buffer;
  let noCharacters: Buffer;

  /**
   * 세 벌을 한 번씩만 렌더해 세 검사가 나눠 쓴다. 한 벌이 101프레임이라 검사마다 다시
   * 찍으면 값이 아니라 시간만 는다.
   */
  beforeAll(async () => {
    earlierNone = await sampleAfterTwoScenes(twoScenes(undefined, PRESENT));
    earlierMissing = await sampleAfterTwoScenes(twoScenes(MISSING, PRESENT));
    noCharacters = await sampleAfterTwoScenes(twoScenes(undefined, undefined));
  }, 900_000);

  /**
   * 이 하네스가 뒤 씬의 캐릭터를 **실제로 그리는지** 먼저 못 박는다. 이게 거짓이면 아래 두
   * 검사는 아무것도 증명하지 못한 채 통과한다.
   */
  it('draws the later scene character in the sampled frame', () => {
    expect(earlierNone.equals(noCharacters)).toBe(false);
  });

  /**
   * **이 검사가 고장을 본다.** `CharacterImage`의 실패 표시가 `src`에 매여 있지 않으면 앞 씬의
   * 404가 컴포넌트 인스턴스에 남아, 뒤 씬의 멀쩡한 캐릭터까지 통째로 사라진다 — 그러면 이
   * 프레임이 "캐릭터를 아예 배정하지 않은 릴"과 바이트까지 같아진다.
   */
  it('keeps the later character after an earlier one 404s', () => {
    expect(earlierMissing.equals(noCharacters)).toBe(false);
  });

  /**
   * 그리고 앞 씬의 실패는 뒤 씬에 **아무 자국도** 남기지 않아야 한다. 앞 씬에 캐릭터를 아예
   * 배정하지 않은 릴과 이 프레임이 바이트까지 같아야 그게 참이다.
   */
  it('renders the later scene exactly as if the earlier scene had no character', () => {
    expect(earlierMissing.equals(earlierNone)).toBe(true);
  });
});
