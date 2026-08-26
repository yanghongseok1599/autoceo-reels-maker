import { synthesizeNarration } from '@/lib/pipeline/tts';
import { transcribeToSubtitles } from '@/lib/pipeline/stt';
import { generateScenes } from '@/lib/pipeline/scenes';
import { getStyleSheet, pickBackground } from '@/lib/style-sheet';
import { renderReel } from '../../worker/render';
import type { EngineId, EngineInput, EngineResult, VideoEngine } from './types';

export const remotionEngine: VideoEngine = {
  id: 'remotion',
  capabilities: {
    aspectRatios: ['9:16'],
    maxDurationSec: 180,
    lipSync: false,
    costModel: 'compute',
    requiresUserKey: false,
  },

  async produce(input: EngineInput, onProgress): Promise<EngineResult> {
    onProgress(10);
    const { audioPath } = await synthesizeNarration({
      text: input.script,
      referenceId: input.voiceReferenceId,
    });

    onProgress(35);
    const subtitles = await transcribeToSubtitles(audioPath);

    onProgress(55);
    const sheet = await getStyleSheet(input.ownerId);
    const scenes = await generateScenes({ script: input.script, subtitles, sheet });
    const durationSec = subtitles.length ? subtitles[subtitles.length - 1].end : 5;

    onProgress(70);
    await renderReel(
      {
        subtitles,
        audioUrl: audioPath,
        scenes,
        durationInSeconds: durationSec,
        palette: sheet.palette,
        backgroundImageUrl: pickBackground(sheet, 0),
      },
      input.outPath,
    );

    onProgress(95);
    return { outputPath: input.outPath, durationSec };
  },
};

const REGISTRY: Partial<Record<EngineId, VideoEngine>> = { remotion: remotionEngine };

export function getEngine(id: EngineId): VideoEngine {
  const engine = REGISTRY[id];
  if (!engine) throw new Error(`구현되지 않은 엔진입니다: ${id}`);
  return engine;
}
