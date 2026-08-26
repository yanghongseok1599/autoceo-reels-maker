export type EngineId = 'remotion' | 'higgsfield' | 'whiteboard';

export interface EngineCapabilities {
  aspectRatios: string[];
  maxDurationSec: number;
  lipSync: boolean;
  costModel: 'compute' | 'credits';
  requiresUserKey: boolean;
}

export interface EngineInput {
  projectId: string;
  ownerId: string;
  script: string;
  voiceReferenceId: string;
  outPath: string;
}

export interface EngineResult {
  outputPath: string;
  durationSec: number;
}

export interface VideoEngine {
  id: EngineId;
  capabilities: EngineCapabilities;
  produce(input: EngineInput, onProgress: (pct: number) => void): Promise<EngineResult>;
}
