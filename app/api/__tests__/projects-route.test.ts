import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { POST as createRoute } from '../projects/route';
import { signSession, type StudentAccount } from '@/lib/auth';
import { store } from '@/lib/store';
import { resetStoreForTests } from '@/lib/store/file-store';
import { upsertFishVoice, type FishVoiceProfile } from '@/lib/fish-voice-store';
import { getProject } from '@/lib/projects';
import type { RenderJob } from '@/lib/jobs';

const student = (id: string): StudentAccount => ({
  id, name: id, codeHash: `hash_${id}`, monthlyRenderCount: 0,
  createdAt: '2026-08-26T00:00:00Z',
});

const voice = (id: string, ownerId: string): FishVoiceProfile => ({
  id, ownerId, name: `${ownerId}의 목소리`, language: 'ko', sampleCount: 1,
  createdAt: '2026-08-26T00:00:00Z',
});

beforeEach(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  await resetStoreForTests();
  await store.write('students', [student('u1'), student('u2')]);
  await store.write('fish-voices', []);
});

function req(body: unknown, studentId?: string) {
  return new Request('http://localhost/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(studentId
        ? { cookie: `student_session=${encodeURIComponent(signSession(studentId))}` }
        : {}),
    },
    body: JSON.stringify(body),
  });
}

const create = async (body: unknown, studentId?: string) => {
  const res = await createRoute(req(body, studentId));
  return { status: res.status, body: await res.json() };
};

describe('POST /api/projects — authentication', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await create({ script: '대본', voiceReferenceId: 'v1' })).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const res = await createRoute(new Request('http://localhost/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'student_session=u1' },
      body: JSON.stringify({ script: '대본', voiceReferenceId: 'v1' }),
    }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/projects — voice ownership', () => {
  /**
   * 목소리를 하나도 등록하지 않은 학생. 운영자 목소리로 슬쩍 대체하지 않고 막는다 —
   * 조용한 대체가 바로 지금 고치고 있는 버그다.
   */
  it('refuses when the student has registered no voice, and says to register one', async () => {
    const { status, body } = await create({ script: '대본', voiceReferenceId: 'anything' }, 'u1');
    expect(status).toBe(400);
    expect(body.error).toContain('목소리를 먼저 등록');
  });

  it('refuses a request with no voice id, with a different message than "register one"', async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    const { status, body } = await create({ script: '대본' }, 'u1');
    expect(status).toBe(400);
    expect(body.error).toContain('선택');
    expect(body.error).not.toContain('목소리를 먼저 등록');
  });

  it('refuses a blank voice id the same way', async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    const { status, body } = await create({ script: '대본', voiceReferenceId: '   ' }, 'u1');
    expect(status).toBe(400);
    expect(body.error).toContain('선택');
  });

  /**
   * 핵심 경계. 소유권 검사를 지우면 u1이 u2의 목소리로 릴스를 만들 수 있고
   * 이 테스트는 200을 받아 실패한다.
   */
  it("refuses a voice id belonging to another student", async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    await upsertFishVoice(voice('theirs', 'u2'));
    const { status, body } = await create({ script: '대본', voiceReferenceId: 'theirs' }, 'u1');
    expect(status).toBe(400);
    expect(body.error).toContain('사용할 수 없는');
  });

  it("creates nothing and charges nothing when the voice is not the caller's", async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    await upsertFishVoice(voice('theirs', 'u2'));
    await create({ script: '대본', voiceReferenceId: 'theirs' }, 'u1');

    /**
     * 프로젝트는 이제 `projects/<id>`처럼 하나씩 저장되고, 목록을 훑는 경로가 일부러 없다.
     * 그래서 "하나도 안 만들어졌다"를 `store`로는 물어볼 수 없어 저장 디렉터리를 직접 본다.
     * 예전처럼 `store.read('projects', [])`로 확인하면 없는 키의 fallback을 받아
     * 무엇을 만들었든 항상 통과하는 빈 검사가 된다.
     */
    expect(existsSync(path.join(process.env.STORE_DIR!, 'projects'))).toBe(false);
    expect(await store.read<RenderJob[]>('jobs', [])).toEqual([]);
    const students = await store.read<StudentAccount[]>('students', []);
    expect(students.find((s) => s.id === 'u1')?.monthlyRenderCount).toBe(0);
  });

  it('accepts the voice the caller owns and stores it on the project', async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    await upsertFishVoice(voice('theirs', 'u2'));
    const { status, body } = await create({ script: '대본', voiceReferenceId: 'mine' }, 'u1');
    expect(status).toBe(200);
    expect((await getProject(body.projectId))?.voiceReferenceId).toBe('mine');
  });

  // 같은 id라도 주인이 다르면 결과가 갈려야 한다 — 검사가 id 존재 여부만 보고 있지 않다는 증거.
  it('lets each student use their own voice and only their own', async () => {
    await upsertFishVoice(voice('mine', 'u1'));
    await upsertFishVoice(voice('theirs', 'u2'));
    expect((await create({ script: '대본', voiceReferenceId: 'theirs' }, 'u2')).status).toBe(200);
    expect((await create({ script: '대본', voiceReferenceId: 'mine' }, 'u2')).status).toBe(400);
  });
});

describe('POST /api/projects — script validation still applies', () => {
  beforeEach(async () => {
    await upsertFishVoice(voice('mine', 'u1'));
  });

  it('rejects an empty script', async () => {
    const { status, body } = await create({ script: '  ', voiceReferenceId: 'mine' }, 'u1');
    expect(status).toBe(400);
    expect(body.error).toContain('대본');
  });

  it('rejects a script over 1500 characters', async () => {
    const { status } = await create({ script: 'ㄱ'.repeat(1501), voiceReferenceId: 'mine' }, 'u1');
    expect(status).toBe(400);
  });
});
