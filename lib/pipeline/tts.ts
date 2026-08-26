import { synthesizeFishSpeech } from '@/lib/fish-audio-client';
import path from 'node:path';

export async function synthesizeNarration(input: {
  text: string; referenceId: string; speakingSpeed?: number; instruct?: string;
}): Promise<{ audioPath: string; durationSec: number }> {
  const result = await synthesizeFishSpeech(input);
  if (result.status === 'error' || !result.audioUrl) {
    throw new Error(result.error ?? '음성 합성에 실패했습니다.');
  }
  return {
    audioPath: path.join(process.cwd(), 'public', result.audioUrl),
    durationSec: result.durationSec ?? 0,
  };
}
