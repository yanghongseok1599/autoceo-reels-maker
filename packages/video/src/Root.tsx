import React from 'react';
import { Composition } from 'remotion';
import type { AnyZodObject } from 'remotion';
import { ReelVertical } from './ReelVertical';
import type { ReelProps } from './types';
import { FALLBACK_PALETTE } from './types';

export const REEL_WIDTH = 1080;
export const REEL_HEIGHT = 1920;
export const REEL_FPS = 30;

export function calculateDurationInFrames(durationInSeconds: number): number {
  return Math.max(1, Math.ceil(durationInSeconds * REEL_FPS));
}

/**
 * Remotion's <Composition> constrains its Props type parameter to `Record<string, unknown>`.
 * `ReelProps` is a plain interface with no index signature, so TypeScript won't accept it as
 * that type argument on its own (`Index signature for type 'string' is missing in type
 * 'ReelProps'`). Intersecting it with `Record<string, unknown>` here — only at this call site,
 * without touching the `ReelProps` declaration in types.ts — satisfies the constraint. The
 * `component` and `defaultProps` props below are still checked against the real `ReelProps`
 * shape: passing our `ReelProps`-shaped fresh object literal (`defaultProps` below) into a
 * `ReelProps & Record<string, unknown>`-typed slot type-checks because TypeScript verifies
 * fresh object literals against index signatures member-by-member (a named variable of type
 * `ReelProps`, by contrast, would still fail — confirmed with a standalone probe against this
 * project's installed remotion (4.0.517) type declarations before applying this fix).
 */
type ComposableReelProps = ReelProps & Record<string, unknown>;

export const RemotionRoot: React.FC = () => (
  <Composition<AnyZodObject, ComposableReelProps>
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
