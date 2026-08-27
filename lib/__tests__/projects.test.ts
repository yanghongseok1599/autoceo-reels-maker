import { describe, it, expect } from 'vitest';
import { createProject, getProject } from '../projects';
import { store } from '../store';

// STORE_DIR은 vitest.setup.ts가 테스트마다 새 임시 디렉터리로 잡아준다.
// 여기서 다시 만들 필요가 없다.

const input = (ownerId: string) => ({ ownerId, script: '대본', voiceReferenceId: 'v1' });

describe('createProject', () => {
  it('stores the script and returns an id', async () => {
    const p = await createProject({ ownerId: 'u1', script: '무릎 통증 팁', voiceReferenceId: 'v1' });
    expect(p.script).toBe('무릎 통증 팁');
    expect((await getProject(p.id))?.ownerId).toBe('u1');
  });

  // 워커는 프로젝트에서만 목소리를 읽는다. 여기서 사라지면 렌더가 목소리를 잃는다.
  it('carries the voice the student chose', async () => {
    const p = await createProject({ ownerId: 'u1', script: '대본', voiceReferenceId: 'voice_u1' });
    expect(p.voiceReferenceId).toBe('voice_u1');
    expect((await getProject(p.id))?.voiceReferenceId).toBe('voice_u1');
  });

  it('starts with no result', async () => {
    expect((await createProject({ ownerId: 'u1', script: '대본', voiceReferenceId: 'v1' })).resultUrl)
      .toBeNull();
  });
});

describe('project storage', () => {
  it('round-trips a project by id', async () => {
    const created = await createProject(input('u1'));
    expect((await getProject(created.id))?.id).toBe(created.id);
  });

  it('returns null for an unknown id', async () => {
    expect(await getProject('proj_nope')).toBeNull();
  });

  /**
   * 이 테스트가 이 Task의 요점이다. 하나의 `projects` 배열을 읽어-수정-쓰던 옛 구조에서는
   * 두 요청이 같은 배열을 읽고 각자 자기 것만 붙여 쓰므로, 나중에 쓴 쪽이 앞의 것을 지웠다.
   * `Promise.all`이라야 그 겹침이 실제로 일어난다 — 순차 await로 바꾸면 옛 구조에서도 통과한다.
   */
  it('keeps both projects when two are created back to back', async () => {
    const [a, b] = await Promise.all([createProject(input('u1')), createProject(input('u2'))]);
    expect(await getProject(a.id)).not.toBeNull();
    expect(await getProject(b.id)).not.toBeNull();
  });

  it('writes each project to its own key', async () => {
    const created = await createProject(input('u1'));
    expect(await store.read(`projects/${created.id}`, null)).not.toBeNull();
    expect(await store.read('projects', null)).toBeNull();
  });

  // 프로젝트를 id로 읽는다고 해서 남의 것이 보이면 안 된다 — 저장된 주인은 그대로 남는다.
  it('keeps each project owned by the student who created it', async () => {
    const [a, b] = await Promise.all([createProject(input('u1')), createProject(input('u2'))]);
    expect((await getProject(a.id))?.ownerId).toBe('u1');
    expect((await getProject(b.id))?.ownerId).toBe('u2');
  });
});
