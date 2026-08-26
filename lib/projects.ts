import { store } from './store';
import type { SubtitleJSON, SceneDirective } from '@studio/video/src/types';
import type { StudentAccount } from './auth';

export const MONTHLY_RENDER_LIMIT = 30;

/** 사용량이 속한 달. UTC 기준 `YYYY-MM`. */
export function currentPeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * 예전에는 `monthlyRenderCount`가 평생 누적됐다 — 이름만 "이번 달"이고 30편을 쓰면
 * 그 수강생은 영영 막혔다. 카운트와 함께 그 카운트가 속한 달을 저장하고, 달이 넘어가면 0부터 센다.
 *
 * `renderPeriod`가 없는 기존 기록은 **이번 달 것으로 본다**. 배포하자마자 모두에게
 * 30편을 새로 주는 것보다 이쪽이 안전한 기본값이다.
 */
export function renderCountInPeriod(student: StudentAccount, now: Date = new Date()): number {
  const period = student.renderPeriod ?? currentPeriod(now);
  return period === currentPeriod(now) ? student.monthlyRenderCount : 0;
}

export function canRender(student: StudentAccount, now: Date = new Date()): boolean {
  return renderCountInPeriod(student, now) < MONTHLY_RENDER_LIMIT;
}

/** 1편을 사용 처리한 학생 레코드를 돌려준다. 달이 바뀌었으면 그 자리에서 초기화된다. */
export function chargeRender(student: StudentAccount, now: Date = new Date()): StudentAccount {
  return {
    ...student,
    renderPeriod: currentPeriod(now),
    monthlyRenderCount: renderCountInPeriod(student, now) + 1,
  };
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
