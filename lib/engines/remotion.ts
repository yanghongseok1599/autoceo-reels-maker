import { synthesizeNarration } from '@/lib/pipeline/tts';
import { transcribeToSubtitles } from '@/lib/pipeline/stt';
import { generateScenes } from '@/lib/pipeline/scenes';
import { getStyleSheet, pickBackground } from '@/lib/style-sheet';
import { renderReel } from '../../worker/render';
import type { EngineId, EngineInput, EngineResult, VideoEngine } from './types';

export const EMPTY_TRANSCRIPTION_ERROR =
  '나레이션에서 자막을 하나도 추출하지 못했습니다. ' +
  '음성이 비어 있거나 whisper 모델이 한국어를 인식하지 못한 경우입니다. ' +
  '대본을 다시 확인하고 시도해주세요.';

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
    const { audioPath, publicPath } = await synthesizeNarration({
      text: input.script,
      referenceId: input.voiceReferenceId,
    });

    onProgress(35);
    const subtitles = await transcribeToSubtitles(audioPath);
    /**
     * 세그먼트가 0건이면 예전에는 길이를 5초로 떨어뜨리고 자막 없는 영상을 만들어 냈다.
     * 60초 대본이 5초짜리 무자막 영상이 되고, 그게 `completed` 100%로 보고됐다.
     * 틀린 산출물을 성공이라고 말하는 것보다 실패하는 편이 낫다.
     */
    if (!subtitles.length) throw new Error(EMPTY_TRANSCRIPTION_ERROR);

    onProgress(55);
    const sheet = await getStyleSheet(input.ownerId);
    const scenes = await generateScenes({ script: input.script, subtitles, sheet });
    const durationSec = subtitles[subtitles.length - 1].end;

    onProgress(70);
    await renderReel(
      {
        subtitles,
        // 절대 파일 경로가 아니라 public 루트 기준 경로다 — worker/render.ts 주석 참고.
        audioUrl: publicPath,
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
