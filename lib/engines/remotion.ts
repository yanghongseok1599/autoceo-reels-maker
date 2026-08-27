import { synthesizeNarration } from '@/lib/pipeline/tts';
import { transcribeToSubtitles } from '@/lib/pipeline/stt';
import { dropUncopiedCharacters, generateScenes } from '@/lib/pipeline/scenes';
import { getStyleSheet, pickBackground } from '@/lib/style-sheet';
import { catalogFor } from '@/lib/clipart-store';
import type { ClipartEntry } from '@/lib/clipart';
import { appPublicDir } from '@/lib/paths';
import { copyClipart, renderReel } from '../../worker/render';
import type { EngineId, EngineInput, EngineResult, VideoEngine } from './types';

export const EMPTY_TRANSCRIPTION_ERROR =
  '나레이션에서 자막을 하나도 추출하지 못했습니다. ' +
  '음성이 비어 있거나 whisper 모델이 한국어를 인식하지 못한 경우입니다. ' +
  '대본을 다시 확인하고 시도해주세요.';

/**
 * 이 수강생의 캐릭터 카탈로그. **읽지 못해도 렌더는 계속된다.**
 *
 * `catalogFor`는 저장소를 읽는다(배포에서는 Blob). 그 호출이 실패했을 때 잡을 것이
 * 없으면 대본도 나레이션도 멀쩡한 릴스가 캐릭터 하나 때문에 통째로 실패한다. 캐릭터가
 * 빠진 릴스와 나오지 않은 릴스는 무게가 다르다 — `loadPresetClipart`가 카탈로그 파일이
 * 깨졌을 때 `[]`를 돌려주는 것과 같은 판단이다.
 */
async function characterCatalog(ownerId: string): Promise<ClipartEntry[]> {
  try {
    return (await catalogFor(ownerId)).entries;
  } catch {
    return [];
  }
}

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
    const catalog = await characterCatalog(input.ownerId);
    const { scenes, usedClipart } = await generateScenes({
      script: input.script, subtitles, sheet, catalog,
    });
    /**
     * 렌더보다 **먼저** 옮긴다. 번들의 public 루트가 여기(`appPublicDir()`)를 심볼릭 링크로
     * 보고 있어서(`worker/render.ts`) 렌더 시점에 디스크에 있으면 그대로 잡힌다. 순서가
     * 뒤집히면 그림이 도착하기 전에 렌더러가 404를 받는다.
     *
     * 그리고 **복사 결과를 반드시 되먹인다.** 못 옮긴 그림을 가리키는 씬을 그대로 넘기면
     * 렌더러가 404를 재시도하다 렌더를 중단한다 — 캐릭터 한 장 때문에 릴스가 통째로
     * 사라지는 자리다(`dropUncopiedCharacters`).
     */
    const drawable = dropUncopiedCharacters(
      scenes, usedClipart, await copyClipart(usedClipart, appPublicDir()),
    );
    const durationSec = subtitles[subtitles.length - 1].end;

    onProgress(70);
    await renderReel(
      {
        subtitles,
        // 절대 파일 경로가 아니라 public 루트 기준 경로다 — worker/render.ts 주석 참고.
        audioUrl: publicPath,
        scenes: drawable,
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
