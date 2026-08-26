import React from 'react';
import { AbsoluteFill, Audio } from 'remotion';
import type { ReelProps } from './types';

export const ReelVertical: React.FC<ReelProps> = ({ audioUrl }) => (
  <AbsoluteFill style={{ backgroundColor: '#0a0a0a' }}>
    {audioUrl && <Audio src={audioUrl} />}
  </AbsoluteFill>
);
