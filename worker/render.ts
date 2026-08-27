import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { appPublicDir } from '../lib/paths';
import { clipartAssetKey, type ClipartEntry } from '../lib/clipart';
import { presetDir } from '../lib/clipart-preset';
import type { ReelProps } from '@studio/video/src/types';

let bundlePromise: Promise<string> | null = null;

/**
 * 나레이션 mp3가 렌더 중인 헤드리스 크롬에 도달하는 유일한 경로다.
 *
 * `<Audio src>`에 넘긴 값은 브라우저에서 `getAbsoluteSrc()`로 번들 서버 origin 기준
 * 절대 URL이 되고(`remotion/dist/cjs/absolute-src.js`), 그 URL을 렌더러가 Node에서 다시
 * 내려받는다. 그 다운로더는 `http://`와 `https://`만 받는다
 * (`@remotion/renderer/dist/assets/read-file.js`의 `getClient`) — 그래서 절대 파일 경로도,
 * `file://` URL도 쓸 수 없다. 남는 방법은 번들의 public 폴더에 올려두고 `staticFile()`로
 * 참조하는 것뿐이다.
 *
 * 번들 기본 public 루트는 엔트리(`packages/video/src/index.ts`) 기준이라 존재하지 않는
 * `packages/video/public`을 가리킨다. 그래서 `publicDir`로 앱의 `public/`을 직접 준다.
 *
 * `symlinkPublicDir`가 핵심이다. 기본값(복사)이면 **번들을 만든 시점의 파일들만** 들어간다.
 * 번들은 워커 수명 동안 한 번만 만들어 캐시하므로, 복사 방식에서는 두 번째 잡부터
 * 나레이션이 번들에 없어서 조용히 무음 영상이 나온다. 심볼릭 링크면 렌더 시점에 디스크를
 * 다시 보므로 나중에 생성된 mp3도 그대로 잡힌다. 이 번들은 워커 전용 임시 산출물이라
 * 배포용 자체 완결성이 필요 없다 — Remotion 타입 주석이 말하는 "throwaway bundle"이 정확히
 * 이 경우다. (Windows에서는 이 옵션이 무시되고 복사로 동작한다. 워커는 맥에서 돈다.)
 */
function getBundle(): Promise<string> {
  bundlePromise ??= bundle({
    entryPoint: path.resolve(process.cwd(), 'packages/video/src/index.ts'),
    publicDir: appPublicDir(),
    symlinkPublicDir: true,
  });
  return bundlePromise;
}

/**
 * 이번 릴스에 실제로 쓰인 클립아트만 렌더 publicDir로 옮긴다.
 *
 * **두 source는 대칭이 아니다.**
 * - `preset`: `file`이 운영자 프리셋 디렉터리(`presetDir()`) 기준 상대 경로다. 그 디렉터리는
 *   `public/` 밖에 있어 렌더러가 닿지 못하고, 118MB라 저장소에 넣을 수도 없다. 여기서
 *   옮기는 것은 **이 경우뿐이다.**
 * - `student`: `file`이 `ArtifactStore.publish`가 돌려준 값이다 — 배포에서는 절대 Blob URL,
 *   로컬에서는 public 루트 기준 상대 경로. 둘 다 이미 도달 가능하므로 복사할 원본 자체가
 *   없다. 굳이 복사하려 들면 프리셋 디렉터리에서 엉뚱한 이름을 찾다 조용히 실패한다.
 *
 * 원본이 없거나 읽히지 않으면 건너뛴다. 캐릭터가 빠진 릴스는 괜찮은 릴스지만, 렌더가
 * 실패한 릴스는 아무것도 아니다 — 무게가 다르다. 한 항목이 실패해도 나머지는 계속 옮긴다.
 */
export async function copyClipart(entries: ClipartEntry[], publicDir: string): Promise<void> {
  for (const entry of entries) {
    // 수강생 이미지는 publish가 이미 도달 가능하게 뒀다
    if (entry.source !== 'preset') continue;
    const target = path.join(publicDir, clipartAssetKey(entry));
    try {
      await mkdir(path.dirname(target), { recursive: true });
      await copyFile(path.join(presetDir(), entry.file), target);
    } catch {
      // 원본 없음 — 이 씬은 캐릭터 없이 렌더된다
    }
  }
}

export async function renderReel(props: ReelProps, outPath: string): Promise<void> {
  const serveUrl = await getBundle();
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({ serveUrl, id: 'ReelVertical', inputProps });
  await renderMedia({ composition, serveUrl, codec: 'h264', outputLocation: outPath, inputProps });
}
