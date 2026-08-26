import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { getEngine } from '../lib/engines/remotion';
import type { EngineId, EngineResult } from '../lib/engines/types';

export interface ClaimedJob { id: string; projectId: string; engine: EngineId }
export interface ClaimedProject { id: string; ownerId: string; script: string }

export interface PollDeps {
  claim: () => Promise<{ job: ClaimedJob | null; project: ClaimedProject | null }>;
  produce: (job: ClaimedJob, project: ClaimedProject) => Promise<EngineResult>;
  report: (id: string, patch: Record<string, unknown>) => Promise<void> | void;
}

export async function pollOnce(deps: PollDeps): Promise<'idle' | 'rendered' | 'failed'> {
  const { job, project } = await deps.claim();
  if (!job) return 'idle';

  if (!project) {
    await deps.report(job.id, { status: 'failed', error: '프로젝트를 찾을 수 없습니다.' });
    return 'failed';
  }

  try {
    const result = await deps.produce(job, project);
    await deps.report(job.id, {
      status: 'completed', progress: 100, resultUrl: result.outputPath,
    });
    return 'rendered';
  } catch (error) {
    await deps.report(job.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

// ── 실제 폴링 루프 (WORKER_RUN=1 일 때만 동작) ──

const API = process.env.APP_URL ?? 'http://localhost:3000';
const TOKEN = process.env.WORKER_TOKEN ?? '';
const VOICE_ID = process.env.FISH_REFERENCE_ID ?? '';
const RENDER_DIR = path.join(process.cwd(), '.local-data', 'renders');
const INTERVAL_MS = 5000;

async function claimFromApi() {
  const res = await fetch(`${API}/api/jobs/next`, {
    method: 'POST', headers: { 'x-worker-token': TOKEN },
  });
  if (!res.ok) return { job: null, project: null };
  return res.json();
}

async function reportToApi(id: string, patch: Record<string, unknown>) {
  await fetch(`${API}/api/jobs/${id}`, {
    method: 'PATCH',
    headers: { 'x-worker-token': TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

async function produceWithEngine(job: ClaimedJob, project: ClaimedProject) {
  await mkdir(RENDER_DIR, { recursive: true });
  return getEngine(job.engine).produce(
    {
      projectId: project.id,
      ownerId: project.ownerId,
      script: project.script,
      voiceReferenceId: VOICE_ID,
      outPath: path.join(RENDER_DIR, `${job.id}.mp4`),
    },
    (pct) => { void reportToApi(job.id, { status: 'rendering', progress: pct }); },
  );
}

if (process.env.WORKER_RUN === '1') {
  console.log(`[worker] ${API} 폴링 시작 (${INTERVAL_MS}ms 간격)`);
  let running = false;
  setInterval(async () => {
    if (running) return;          // 이전 렌더가 끝나기 전에 새 잡을 잡지 않는다
    running = true;
    try {
      const result = await pollOnce({
        claim: claimFromApi, produce: produceWithEngine, report: reportToApi,
      });
      if (result !== 'idle') console.log(`[worker] ${result}`);
    } catch (error) {
      console.error('[worker] 폴링 실패', error);
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
}
