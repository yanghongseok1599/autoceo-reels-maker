import { synthesizeFishSpeech } from '@/lib/fish-audio-client';
import { appPublicDir } from '@/lib/paths';
import path from 'node:path';

/**
 * `durationSec`는 반환하지 않는다. `synthesizeFishSpeech`의 성공 경로가 그 값을 세팅하지 않아
 * 항상 0이 되고, 0을 길이로 믿는 호출자를 만들 뿐이다. 길이는 STT 결과의 마지막 세그먼트
 * 끝시각에서 얻는다(Task 9 참조).
 */
export async function synthesizeNarration(input: {
  text: string; referenceId: string; speakingSpeed?: number; instruct?: string;
}): Promise<{ audioPath: string; publicPath: string }> {
  const result = await synthesizeFishSpeech(input);
  if (result.status === 'error' || !result.audioUrl) {
    throw new Error(result.error ?? '음성 합성에 실패했습니다.');
  }
  return {
    /** whisper.cpp에 넘길 디스크 경로 */
    audioPath: path.join(appPublicDir(), result.audioUrl),
    /** Remotion public 루트 기준 경로. `<Audio src>`가 실제로 로드되는 유일한 형태다. */
    publicPath: result.audioUrl.replace(/^\//, ''),
  };
}
