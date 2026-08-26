import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { getEngine } from '../lib/engines/remotion';
import { selectArtifactStore } from '../lib/store';
import type { EngineId, EngineResult } from '../lib/engines/types';

export interface ClaimedJob { id: string; projectId: string; engine: EngineId }
export interface ClaimedProject { id: string; ownerId: string; script: string }

export interface PollDeps {
  claim: () => Promise<{ job: ClaimedJob | null; project: ClaimedProject | null }>;
  produce: (job: ClaimedJob, project: ClaimedProject) => Promise<EngineResult>;
  /** 렌더된 파일을 브라우저가 열 수 있는 URL로 바꾼다. 이게 없으면 학생은 결과를 못 본다. */
  publish: (job: ClaimedJob, result: EngineResult) => Promise<string>;
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
    /**
     * 예전에는 `result.outputPath`(워커 맥의 파일 경로)를 그대로 `resultUrl`로 보고했다.
     * 브라우저는 그 경로를 열 수 없다 — 학생 화면에는 결과가 영영 뜨지 않았다.
     * 업로드해서 받은 URL만 보고한다. 업로드가 실패하면 잡도 실패다.
     */
    const resultUrl = await deps.publish(job, result);
    await deps.report(job.id, { status: 'completed', progress: 100, resultUrl });
    return 'rendered';
  } catch (error) {
    await deps.report(job.id, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    return 'failed';
  }
}

// ── 기동 시 환경 검증 ──

/**
 * `tsx`는 `.env`를 읽지 않고 이 저장소에는 dotenv 의존성도 없다. 값이 없으면 워커는
 * 조용히 뜬 뒤 첫 잡을 TTS 단계에서 죽이고, 그 잡은 학생의 이번 달 생성 횟수를 이미 깎은 뒤다.
 * 그러니 폴링을 시작하기 전에 없는 이름을 전부 알려주고 멈춘다.
 */
export const REQUIRED_WORKER_ENV = [
  'WORKER_TOKEN',       // /api/jobs/* 인증
  'APP_URL',            // 폴링 대상 앱 주소
  'FISH_REFERENCE_ID',  // TTS 보이스 모델
  'FISH_API_KEY',       // TTS 인증
  'WHISPER_MODEL',      // STT ggml 모델 절대 경로
] as const;

export function missingWorkerEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return REQUIRED_WORKER_ENV.filter((name) => !env[name]?.trim());
}

export function workerEnvErrorMessage(missing: string[]): string {
  return [
    `[worker] 환경변수가 설정되지 않아 시작할 수 없습니다: ${missing.join(', ')}`,
    '[worker] tsx는 .env를 읽지 않습니다. 실행 명령 앞에 직접 붙여주세요:',
    `[worker]   ${missing.map((name) => `${name}=<값>`).join(' ')} WORKER_RUN=1 npx tsx worker/index.ts`,
  ].join('\n');
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

/**
 * 진행률 보고는 실패해도 렌더를 죽이면 안 된다.
 * `void`만으로는 부족하다 — 동기 예외만 막을 뿐 거부(rejection)는 그대로 새어나가고,
 * Node 기본값(`--unhandled-rejections=throw`)에서는 렌더 도중 워커가 죽는다. `.catch`가 필요하다.
 */
export function makeProgressReporter(
  report: (id: string, patch: Record<string, unknown>) => Promise<unknown>,
) {
  return (jobId: string) => (pct: number): void => {
    void report(jobId, { status: 'rendering', progress: pct }).catch(() => {});
  };
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
    makeProgressReporter(reportToApi)(job.id),
  );
}

export function artifactKeyFor(jobId: string): string {
  return `renders/${jobId}.mp4`;
}

async function publishToStore(job: ClaimedJob, result: EngineResult) {
  return selectArtifactStore().publish(result.outputPath, artifactKeyFor(job.id));
}

if (process.env.WORKER_RUN === '1') {
  const missing = missingWorkerEnv();
  if (missing.length) {
    console.error(workerEnvErrorMessage(missing));
    process.exit(1);
  }

  console.log(`[worker] ${API} 폴링 시작 (${INTERVAL_MS}ms 간격)`);
  let running = false;
  setInterval(async () => {
    if (running) return;          // 이전 렌더가 끝나기 전에 새 잡을 잡지 않는다
    running = true;
    try {
      const result = await pollOnce({
        claim: claimFromApi,
        produce: produceWithEngine,
        publish: publishToStore,
        report: reportToApi,
      });
      if (result !== 'idle') console.log(`[worker] ${result}`);
    } catch (error) {
      console.error('[worker] 폴링 실패', error);
    } finally {
      running = false;
    }
  }, INTERVAL_MS);
}
