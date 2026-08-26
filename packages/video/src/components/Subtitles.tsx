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
