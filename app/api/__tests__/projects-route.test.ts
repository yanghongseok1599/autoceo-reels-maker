import { describe, it, expect, beforeEach, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { POST as createRoute } from '../projects/route';
import {
  getStudent,
  saveStudent,
  signSession,
  verifyInviteCode,
  type StudentAccount,
} from '@/lib/auth';
import { seedStudent } from '@/scripts/seed-student';
import { store } from '@/lib/store';
import { resetStoreForTests } from '@/lib/store/file-store';
import { upsertFishVoice, type FishVoiceProfile } from '@/lib/fish-voice-store';
import { getProject } from '@/lib/projects';
import type { JobIndexEntry } from '@/lib/jobs';

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
  // 계정은 이제 `students/<id>`에 하나씩 들어간다. 옛 `students` 배열에 심으면 라우트가
  // 읽지 않아 모든 테스트가 401을 받는다.
  await saveStudent(student('u1'));
  await saveStudent(student('u2'));
  // 목소리는 이제 소유자별 키에 들어가므로 비울 공유 배열이 없다. 이 파일은 목소리를
  // `upsertFishVoice`로 심고, `STORE_DIR`은 테스트마다 새것이다(`vitest.setup.ts`).
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

  /**
   * 서명은 **맞는데** 그 계정이 없는 경우. 탈퇴·삭제된 계정의 쿠키가 30일 동안 살아 있고,
   * `student-index`가 어긋나 정본 레코드가 사라진 뒤에도 같은 일이 생긴다. 서명 검사만
   * 통과시키고 레코드 확인을 건너뛰면 그 다음 줄부터는 `student`가 없는 채로 한도 계산과
   * 차감이 돌아, 사라진 계정으로 릴스를 만들거나 라우트가 500으로 터진다.
   */
  it('rejects a validly signed session whose student record no longer exists', async () => {
    const { status, body } = await create(
      { script: '대본', voiceReferenceId: 'mine' },
      'stu_deleted',
    );
    expect(status).toBe(401);
    expect(body.error).toBe('로그인이 필요합니다.');
  });

  it('creates nothing for a validly signed session with no student record', async () => {
    await create({ script: '대본', voiceReferenceId: 'mine' }, 'stu_deleted');
    expect(existsSync(path.join(process.env.STORE_DIR!, 'projects'))).toBe(false);
    expect(await store.read<JobIndexEntry[]>('job-index', [])).toEqual([]);
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
    /**
     * 잡도 마찬가지로 `jobs/<id>`에 하나씩 들어간다. `store.read('jobs', [])`로 확인하면
     * 이제는 없는 키의 fallback을 받아 큐에 무엇이 들어갔든 항상 통과한다. 그래서 잡 디렉터리
     * 자체와, 큐가 실제로 보는 투영인 `job-index`를 본다.
     */
    expect(existsSync(path.join(process.env.STORE_DIR!, 'jobs'))).toBe(false);
    expect(await store.read<JobIndexEntry[]>('job-index', [])).toEqual([]);
    expect((await getStudent('u1'))?.monthlyRenderCount).toBe(0);
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

/**
 * 생성 횟수 차감이 **다른 계정을 지우지 않는다**는 것.
 *
 * 옛 구조에서는 이 라우트가 `students` 배열 **전체**를 읽어(:14) 고쳐 다시 썼다(:47).
 * 그 사이에는 `authorizeVoice`·`createProject`·`enqueueJob`이 돈다 — 100ms가 넘는 창이다.
 * 운영자가 그 창 안에서 초대코드를 발급하면, 라우트의 쓰기가 방금 만들어진 계정을
 * **되돌릴 수 없게 지운다.** 그 수강생의 초대코드는 영영 듣지 않고, 본인도 운영자도
 * 아무 신호를 받지 못한다(발급 스크립트는 이미 성공을 출력한 뒤다).
 *
 * 원자적 쓰기(Task 8)는 파일이 **찢어지는 것**을 막았을 뿐 갱신 유실을 막지 못한다 —
 * 마지막 쓰기가 온전한 옛 배열로 이긴다. 키를 나누는 것만이 이걸 없앤다.
 */
describe('POST /api/projects — 렌더 중에 발급된 계정', () => {
  /**
   * 지연은 창을 **넓히기만** 한다. 라우트가 차감을 쓰려는 바로 그 순간에 발급이 끼어들게
   * 해서, 실제로는 타이밍에 달린 경합을 결정적으로 만든다. 키 접두사로 거는 이유는 이
   * 테스트가 **분리 전후 양쪽에서 같은 순간**을 잡아야 하기 때문이다 — 옛 코드는
   * `students`를, 새 코드는 `students/u1`을 쓴다.
   */
  async function seedWhileChargeIsInFlight(name: string, code: string) {
    let seeding: Promise<unknown> | null = null;
    const passthrough = store.write.bind(store);
    const spy = vi.spyOn(store, 'write').mockImplementation(async (key, value) => {
      if (!seeding && typeof key === 'string' && key.startsWith('students')) {
        seeding = seedStudent(name, code); // 발급의 쓰기는 이 스파이를 그냥 지나간다
        await seeding;
      }
      return passthrough(key, value);
    });
    try {
      const result = await create({ script: '대본', voiceReferenceId: 'mine' }, 'u1');
      return { result, seeded: seeding as Promise<unknown> | null };
    } finally {
      spy.mockRestore();
    }
  }

  beforeEach(async () => {
    await upsertFishVoice(voice('mine', 'u1'));
  });

  it('keeps a student seeded while the render charge is in flight', async () => {
    const { result, seeded } = await seedWhileChargeIsInFlight('새수강생', 'NEWA-1111');

    expect(result.status).toBe(200);
    expect(seeded).not.toBeNull(); // 창을 못 잡았으면 이 테스트는 아무것도 증명하지 않는다
    await seeded;

    const account = await verifyInviteCode('NEWA-1111');
    expect(account?.name).toBe('새수강생');
  });

  it('still charges the caller while doing so', async () => {
    await seedWhileChargeIsInFlight('새수강생', 'NEWB-2222');
    expect((await getStudent('u1'))?.monthlyRenderCount).toBe(1);
  });

  /** 수강생 둘이 동시에 만들면 차감이 서로를 덮지 않는다 — 형제 계층과 같은 경계다. */
  it('charges both students when two render at the same time', async () => {
    await upsertFishVoice(voice('theirs', 'u2'));
    const [a, b] = await Promise.all([
      create({ script: '대본', voiceReferenceId: 'mine' }, 'u1'),
      create({ script: '대본', voiceReferenceId: 'theirs' }, 'u2'),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await getStudent('u1'))?.monthlyRenderCount).toBe(1);
    expect((await getStudent('u2'))?.monthlyRenderCount).toBe(1);
  });
});
