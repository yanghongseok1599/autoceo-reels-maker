import { store } from './store';

export const STALE_CLAIM_MS = 15 * 60 * 1000;

export interface RenderJob {
  id: string;
  projectId: string;
  ownerId: string;
  engine: 'remotion';
  status: 'queued' | 'claimed' | 'rendering' | 'completed' | 'failed';
  progress: number;
  claimedAt: string | null;
  resultUrl: string | null;
  error: string | null;
  createdAt: string;
}

const KEY = 'jobs';
const read = () => store.read<RenderJob[]>(KEY, []);
const write = (jobs: RenderJob[]) => store.write(KEY, jobs);

export async function enqueueJob(input: { projectId: string; ownerId: string }): Promise<RenderJob> {
  const jobs = await read();
  const job: RenderJob = {
    id: `job_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    projectId: input.projectId,
    ownerId: input.ownerId,
    engine: 'remotion',
    status: 'queued',
    progress: 0,
    claimedAt: null,
    resultUrl: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  await write([...jobs, job]);
  return job;
}

function isClaimable(job: RenderJob, now: Date): boolean {
  if (job.status === 'queued') return true;
  if (job.status !== 'claimed' && job.status !== 'rendering') return false;
  if (!job.claimedAt) return false;
  return now.getTime() - Date.parse(job.claimedAt) > STALE_CLAIM_MS;
}

export async function claimNextJob(now: Date = new Date()): Promise<RenderJob | null> {
  const jobs = await read();
  const target = jobs
    .filter((j) => isClaimable(j, now))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
  if (!target) return null;

  const claimed: RenderJob = { ...target, status: 'claimed', claimedAt: now.toISOString() };
  await write(jobs.map((j) => (j.id === claimed.id ? claimed : j)));
  return claimed;
}

export async function updateJob(
  id: string,
  patch: Partial<Pick<RenderJob, 'status' | 'progress' | 'resultUrl' | 'error'>>,
): Promise<RenderJob | null> {
  const jobs = await read();
  const next = jobs.map((j) => (j.id === id ? { ...j, ...patch } : j));
  await write(next);
  return next.find((j) => j.id === id) ?? null;
}

export async function getJob(id: string): Promise<RenderJob | null> {
  return (await read()).find((j) => j.id === id) ?? null;
}
