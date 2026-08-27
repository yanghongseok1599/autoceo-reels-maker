import { describe, it, expect } from 'vitest';
import { shardStore, LEGACY_OWNER } from '../shard-store';
import { store } from '../../lib/store';
import { getProject } from '../../lib/projects';
import { claimNextJob, type JobIndexEntry } from '../../lib/jobs';
import { getStyleSheet } from '../../lib/style-sheet';

/**
 * `STORE_DIR`은 `vitest.setup.ts`가 테스트마다 새 임시 디렉터리로 잡아 준다.
 * 여기서 다시 잡지 않는다 — 두 곳에서 잡으면 어느 쪽이 이기는지가 파일 로드 순서에 달린다.
 *
 * 이 파일은 **일부러 옛 배열 키에 쓴다.** 아무도 읽지 않는 키를 읽어 fallback을 받고
 * 통과하는 함정을 피하려고, 모든 단언은 "이전이 실제로 일어났을 때만" 참이 되게 적었다 —
 * 옛 키가 그대로인지 보는 테스트조차 새 키를 함께 본다.
 */

const anyJob = (over: Record<string, unknown> = {}) => ({
  id: 'job_a',
  projectId: 'proj_a',
  ownerId: 'u1',
  engine: 'remotion',
  status: 'queued',
  progress: 0,
  claimedAt: null,
  resultUrl: null,
  error: null,
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

const readObject = (key: string) => store.read<Record<string, unknown> | null>(key, null);
const readList = (key: string) => store.read<Record<string, unknown>[]>(key, []);

describe('shardStore — 프로젝트', () => {
  it('프로젝트를 id별 키로 옮긴다', async () => {
    await store.write('projects', [
      { id: 'proj_a', ownerId: 'u1' },
      { id: 'proj_b', ownerId: 'u2' },
    ]);

    const result = await shardStore();

    expect(result.moved.projects).toBe(2);
    expect(await readObject('projects/proj_a')).toMatchObject({ id: 'proj_a', ownerId: 'u1' });
    expect(await readObject('projects/proj_b')).toMatchObject({ id: 'proj_b', ownerId: 'u2' });
  });

  it('옛 키를 남겨 둬서 잘못된 실행을 되돌릴 수 있다', async () => {
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1' }]);

    await shardStore();

    expect(await readList('projects')).toHaveLength(1);
    // 옛 키만 보면 아무것도 하지 않은 구현도 통과한다. 옮겨졌다는 것까지 함께 본다.
    expect(await readObject('projects/proj_a')).not.toBeNull();
  });

  it('분리 뒤에 진행된 값을 옛 배열로 덮지 않는다', async () => {
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1', script: '옛 대본' }]);
    await store.write('projects/proj_a', { id: 'proj_a', ownerId: 'u1', script: '새 대본' });

    const result = await shardStore();

    expect(await readObject('projects/proj_a')).toMatchObject({ script: '새 대본' });
    expect(result.moved.projects).toBe(0);
    expect(result.alreadyThere.projects).toBe(1);
  });

  it('id 없는 레코드는 옮기지 않고 보고한다', async () => {
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1' }, { ownerId: 'u1' }]);

    const result = await shardStore();

    expect(result.moved.projects).toBe(1);
    expect(result.unkeyed.projects).toBe(1);
  });
});

describe('shardStore — 잡', () => {
  it('잡을 id별 키로 옮기고 인덱스를 만든다', async () => {
    await store.write('jobs', [
      anyJob({ status: 'completed', claimedAt: '2026-01-01T00:01:00Z' }),
    ]);

    const result = await shardStore();

    expect(result.moved.jobs).toBe(1);
    expect(await readObject('jobs/job_a')).toMatchObject({ id: 'job_a', projectId: 'proj_a' });
    // 항목 모양은 `lib/jobs.ts`가 쓰는 그대로여야 한다. 잡 전체를 넣으면 여기서 걸린다.
    expect(await store.read<JobIndexEntry[]>('job-index', [])).toEqual([
      {
        id: 'job_a',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00Z',
        claimedAt: '2026-01-01T00:01:00Z',
      },
    ]);
  });

  it('옮겨진 잡이 자기 프로젝트를 계속 찾는다', async () => {
    // 분리 순간에 떠 있던 잡의 실제 경로: claimNextJob → getProject(job.projectId).
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1', script: '대본' }]);
    await store.write('jobs', [anyJob()]);

    await shardStore();

    const claimed = await claimNextJob(new Date('2026-01-02T00:00:00Z'));
    expect(claimed?.id).toBe('job_a');
    expect((await getProject(claimed!.projectId))?.id).toBe('proj_a');
  });

  it('인덱스에 살아 있는 항목을 옛 잡으로 되돌리지 않는다', async () => {
    await store.write('jobs', [anyJob({ status: 'queued' })]);
    await store.write('job-index', [
      { id: 'job_a', status: 'completed', createdAt: '2026-01-01T00:00:00Z', claimedAt: null },
    ]);

    await shardStore();

    const index = await store.read<JobIndexEntry[]>('job-index', []);
    expect(index).toHaveLength(1);
    expect(index[0].status).toBe('completed');
  });
});

describe('shardStore — 소유자별 키', () => {
  it('클립아트를 소유자별로 모은다', async () => {
    await store.write('clipart-library', [
      { id: 'c1', ownerId: 'u1', keyword: '기쁨' },
      { id: 'c2', ownerId: 'u1', keyword: '슬픔' },
      { id: 'c3', ownerId: 'u2', keyword: '분노' },
    ]);

    const result = await shardStore();

    expect(result.moved['clipart-library']).toBe(3);
    expect(await readList('clipart-library/u1')).toHaveLength(2);
    expect(await readList('clipart-library/u2')).toHaveLength(1);
  });

  it('목소리를 소유자별로 모은다', async () => {
    await store.write('fish-voices', [
      { id: 'v1', ownerId: 'u1', name: '내 목소리' },
      { id: 'v2', ownerId: 'u2', name: '남의 목소리' },
    ]);

    await shardStore();

    expect((await readList('fish-voices/u1')).map((v) => v.id)).toEqual(['v1']);
    expect((await readList('fish-voices/u2')).map((v) => v.id)).toEqual(['v2']);
  });

  it('이미 있는 항목은 그대로 두고 빠진 것만 채운다', async () => {
    await store.write('clipart-library', [
      { id: 'c1', ownerId: 'u1', keyword: '기쁨' },
      { id: 'c2', ownerId: 'u1', keyword: '슬픔' },
    ]);
    // 이전이 도중에 끊겼거나, 분리 뒤 수강생이 c2를 다시 올렸다.
    await store.write('clipart-library/u1', [{ id: 'c2', ownerId: 'u1', keyword: '슬픔(고침)' }]);

    const result = await shardStore();

    // 살아 있는 c2가 이기고, 옛 배열에만 있던 c1이 뒤에 붙는다.
    expect(await readList('clipart-library/u1')).toEqual([
      { id: 'c2', ownerId: 'u1', keyword: '슬픔(고침)' },
      { id: 'c1', ownerId: 'u1', keyword: '기쁨' },
    ]);
    expect(result.moved['clipart-library']).toBe(1);
    expect(result.alreadyThere['clipart-library']).toBe(1);
  });

  it('스타일시트는 배열이 아니라 시트 하나로 들어간다', async () => {
    await store.write('style-sheets', [
      {
        ownerId: 'u1',
        presetId: 'paper',
        styleSheetUrl: null,
        palette: { accent: '#c8553d', ink: '#2b2118', paper: '#f2e8d5' },
        toneWords: ['종이 질감'],
        backgroundLibrary: ['bg1.png'],
      },
    ]);

    const result = await shardStore();

    expect(result.moved['style-sheets']).toBe(1);
    expect(Array.isArray(await readObject('style-sheets/u1'))).toBe(false);
    // 앱이 실제로 읽는 경로로 확인한다. 소유자가 어긋나면 기본 프리셋이 나온다.
    expect(await getStyleSheet('u1')).toMatchObject({
      presetId: 'paper',
      backgroundLibrary: ['bg1.png'],
    });
  });

  it('분리 뒤에 저장된 시트를 옛 배열로 덮지 않는다', async () => {
    await store.write('style-sheets', [{ ownerId: 'u1', presetId: 'paper' }]);
    await store.write('style-sheets/u1', { ownerId: 'u1', presetId: 'gym' });

    const result = await shardStore();

    expect(await readObject('style-sheets/u1')).toMatchObject({ presetId: 'gym' });
    expect(result.moved['style-sheets']).toBe(0);
    expect(result.alreadyThere['style-sheets']).toBe(1);
  });
});

describe('shardStore — 주인 모를 기록', () => {
  it('소유자 없는 학습 기록을 __legacy__에 모은다', async () => {
    await store.write('learning-records', [{ id: 'l1', format: 'format_a' }]);

    const result = await shardStore();

    expect(await readList(`learning-records/${LEGACY_OWNER}`)).toHaveLength(1);
    expect(result.legacy['learning-records']).toBe(1);
  });

  it('소유자 없는 기록을 실제 수강생 자리에 넣지 않는다', async () => {
    await store.write('learning-records', [
      { id: 'l1', ownerId: 'u1', format: 'format_a', script: '내 대본' },
      { id: 'l2', format: 'format_a', script: '주인 모를 대본' },
    ]);

    await shardStore();

    expect((await readList('learning-records/u1')).map((r) => r.id)).toEqual(['l1']);
    expect((await readList(`learning-records/${LEGACY_OWNER}`)).map((r) => r.id)).toEqual(['l2']);
  });

  it('빈 ownerId도 __legacy__로 간다', async () => {
    await store.write('clipart-library', [
      { id: 'c1', ownerId: 'u1', keyword: '기쁨' },
      { id: 'c2', ownerId: '   ', keyword: '슬픔' },
    ]);

    const result = await shardStore();

    expect((await readList('clipart-library/u1')).map((e) => e.id)).toEqual(['c1']);
    expect((await readList(`clipart-library/${LEGACY_OWNER}`)).map((e) => e.id)).toEqual(['c2']);
    expect(result.legacy['clipart-library']).toBe(1);
  });

  it('키를 벗어나는 소유자 값으로 저장소 밖에 쓰지 않는다', async () => {
    await store.write('fish-voices', [{ id: 'v1', ownerId: '../escape' }]);

    await expect(shardStore()).resolves.toBeTruthy();

    expect((await readList(`fish-voices/${LEGACY_OWNER}`)).map((v) => v.id)).toEqual(['v1']);
  });
});

describe('shardStore — 보고와 재실행', () => {
  it('옛 키가 아예 없으면 건너뛴다', async () => {
    const result = await shardStore();

    expect(result.skipped).toContain('projects');
    expect(result.moved.projects).toBeUndefined();
  });

  it('빈 옛 키는 건너뛴 것과 구분해 0으로 보고한다', async () => {
    await store.write('projects', []);

    const result = await shardStore();

    expect(result.skipped).not.toContain('projects');
    expect(result.moved.projects).toBe(0);
  });

  it('두 번 돌려도 늘어나거나 망가지지 않는다', async () => {
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1' }]);
    await store.write('jobs', [anyJob()]);
    await store.write('clipart-library', [{ id: 'c1', ownerId: 'u1', keyword: '기쁨' }]);
    await store.write('learning-records', [{ id: 'l1', format: 'format_a' }]);

    await shardStore();
    const second = await shardStore();

    expect(await readObject('projects/proj_a')).toMatchObject({ id: 'proj_a' });
    expect(await readList('clipart-library/u1')).toHaveLength(1);
    expect(await readList(`learning-records/${LEGACY_OWNER}`)).toHaveLength(1);
    expect(await store.read<JobIndexEntry[]>('job-index', [])).toHaveLength(1);
    expect(second.moved).toEqual({
      projects: 0,
      jobs: 0,
      'job-index': 0,
      'clipart-library': 0,
      'learning-records': 0,
    });
  });

  it('이전 뒤에 생긴 데이터를 다시 돌려도 지우지 않는다', async () => {
    await store.write('clipart-library', [{ id: 'c1', ownerId: 'u1', keyword: '기쁨' }]);
    await shardStore();

    // 이전이 끝난 뒤 수강생이 하나 더 올렸다.
    await store.write('clipart-library/u1', [
      ...(await readList('clipart-library/u1')),
      { id: 'c2', ownerId: 'u1', keyword: '슬픔' },
    ]);

    await shardStore();

    expect((await readList('clipart-library/u1')).map((e) => e.id)).toEqual(['c1', 'c2']);
  });

  it('students는 건드리지 않는다', async () => {
    await store.write('students', [{ id: 'u1' }]);

    const result = await shardStore();

    expect(await readList('students')).toHaveLength(1);
    expect(await store.list('students')).toEqual([]);
    expect(result.moved.students).toBeUndefined();
  });
});
