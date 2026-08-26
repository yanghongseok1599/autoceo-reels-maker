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
