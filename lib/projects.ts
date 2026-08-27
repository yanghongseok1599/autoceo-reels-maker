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
  /**
   * 이 프로젝트를 읽어줄 목소리. 워커가 전역 `FISH_REFERENCE_ID`를 쓰던 시절에는
   * 모든 학생의 릴스가 운영자 목소리로 나왔다. 목소리는 잡과 함께 이동한다.
   */
  voiceReferenceId: string;
  audioUrl: string | null; subtitles: SubtitleJSON | null;
  scenes: SceneDirective[] | null; resultUrl: string | null; createdAt: string;
}

/**
 * 프로젝트는 자기 id로만 조회된다(`app/api/jobs/next/route.ts`). 목록을 훑는 곳이 없으므로
 * 인덱스도 두지 않는다 — 인덱스를 두면 그 인덱스가 다시 하나의 배열이 되어, 지금 고치는
 * 덮어쓰기 문제를 그대로 되살린다.
 *
 * 예전에는 모든 프로젝트가 `projects` 배열 하나에 들어 있었다. 만들 때마다 배열 전체를
 * 읽어-수정-쓰기 때문에, 두 수강생이 동시에 만들면 나중에 쓴 쪽이 앞사람 것을 지웠다.
 * 키를 프로젝트마다 나누면 두 쓰기가 서로 다른 파일로 가서 겹칠 일이 없다.
 */
const projectKey = (id: string) => `projects/${id}`;

export async function createProject(
  input: { ownerId: string; script: string; voiceReferenceId: string },
): Promise<Project> {
  const project: Project = {
    id: `proj_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    ownerId: input.ownerId, engine: 'remotion', script: input.script,
    voiceReferenceId: input.voiceReferenceId,
    audioUrl: null, subtitles: null, scenes: null, resultUrl: null,
    createdAt: new Date().toISOString(),
  };
  await store.write(projectKey(project.id), project);
  return project;
}

export async function getProject(id: string): Promise<Project | null> {
  return await store.read<Project | null>(projectKey(id), null);
}
