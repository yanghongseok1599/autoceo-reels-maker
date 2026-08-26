import { synthesizeFishSpeech } from '@/lib/fish-audio-client';
import path from 'node:path';

/**
 * `durationSec`는 반환하지 않는다. `synthesizeFishSpeech`의 성공 경로가 그 값을 세팅하지 않아
 * 항상 0이 되고, 0을 길이로 믿는 호출자를 만들 뿐이다. 길이는 STT 결과의 마지막 세그먼트
 * 끝시각에서 얻는다(Task 9 참조).
 */
export async function synthesizeNarration(input: {
  text: string; referenceId: string; speakingSpeed?: number; instruct?: string;
}): Promise<{ audioPath: string }> {
  const result = await synthesizeFishSpeech(input);
  if (result.status === 'error' || !result.audioUrl) {
    throw new Error(result.error ?? '음성 합성에 실패했습니다.');
  }
  return {
    audioPath: path.join(process.cwd(), 'public', result.audioUrl),
  };
}
