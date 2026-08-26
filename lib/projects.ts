import { store } from './store';
import type { SubtitleJSON, SceneDirective } from '@studio/video/src/types';
import type { StudentAccount } from './auth';

export const MONTHLY_RENDER_LIMIT = 30;

export function canRender(student: StudentAccount): boolean {
  return student.monthlyRenderCount < MONTHLY_RENDER_LIMIT;
}

export interface Project {
  id: string; ownerId: string; engine: 'remotion'; script: string;
  audioUrl: string | null; subtitles: SubtitleJSON | null;
  scenes: SceneDirective[] | null; resultUrl: string | null; createdAt: string;
}

const KEY = 'projects';

export async function createProject(input: { ownerId: string; script: string }): Promise<Project> {
  const projects = await store.read<Project[]>(KEY, []);
  const project: Project = {
    id: `proj_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    ownerId: input.ownerId, engine: 'remotion', script: input.script,
    audioUrl: null, subtitles: null, scenes: null, resultUrl: null,
    createdAt: new Date().toISOString(),
  };
  await store.write(KEY, [project, ...projects]);
  return project;
}

export async function getProject(id: string): Promise<Project | null> {
  return (await store.read<Project[]>(KEY, [])).find((p) => p.id === id) ?? null;
}
