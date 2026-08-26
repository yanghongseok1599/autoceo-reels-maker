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
