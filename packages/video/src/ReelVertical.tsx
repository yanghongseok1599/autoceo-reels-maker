import React from 'react';
import { AbsoluteFill, Audio } from 'remotion';
import type { ReelProps } from './types';

export const ReelVertical: React.FC<ReelProps> = ({ audioUrl, palette }) => (
  <AbsoluteFill style={{ backgroundColor: palette.paper }}>
    {audioUrl && <Audio src={audioUrl} />}
  </AbsoluteFill>
);
