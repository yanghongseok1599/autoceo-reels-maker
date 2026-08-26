import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GET as profilesRoute } from '../voicebox/profiles/route';
import { signSession } from '@/lib/auth';
import { store } from '@/lib/store';
import { listFishVoices, type FishVoiceProfile } from '@/lib/fish-voice-store';

const voice = (id: string, ownerId: string): FishVoiceProfile => ({
  id, ownerId, name: `${ownerId}의 목소리`, language: 'ko', sampleCount: 1,
  createdAt: '2026-08-26T00:00:00Z',
});

beforeEach(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.FISH_API_KEY = 'test-fish-key';
  await store.write('fish-voices', []);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

function cookieFor(studentId: string) {
  return { cookie: `student_session=${encodeURIComponent(signSession(studentId))}` };
}

describe('GET /api/voicebox/profiles', () => {
  const list = async (studentId?: string) => {
    const res = await profilesRoute(new Request('http://localhost/api/voicebox/profiles', {
      headers: studentId ? cookieFor(studentId) : {},
    }));
    return { status: res.status, body: await res.json() };
  };

  it('rejects an unauthenticated listing', async () => {
    expect((await list()).status).toBe(401);
  });

  it('rejects a forged session cookie', async () => {
    const res = await profilesRoute(new Request('http://localhost/api/voicebox/profiles', {
      headers: { cookie: 'student_session=u1' },
    }));
    expect(res.status).toBe(401);
  });

  /**
   * 클론한 목소리는 개인 정보다. 이 필터가 없으면 수강생 피커에 남의 목소리가 뜨고
   * 그 id를 그대로 렌더 요청에 쓸 수 있다.
   */
  it("excludes another student's cloned voice", async () => {
    await store.write('fish-voices', [voice('mine', 'u1'), voice('theirs', 'u2')]);
    const { status, body } = await list('u1');
    expect(status).toBe(200);
    expect(body.profiles.map((p: { id: string }) => p.id)).toEqual(['mine']);
  });

  it('gives each student their own list', async () => {
    await store.write('fish-voices', [voice('mine', 'u1'), voice('theirs', 'u2')]);
    expect((await list('u2')).body.profiles.map((p: { id: string }) => p.id)).toEqual(['theirs']);
  });

  it('returns an empty list for a student who has cloned nothing', async () => {
    await store.write('fish-voices', [voice('theirs', 'u2')]);
    expect((await list('u1')).body.profiles).toEqual([]);
  });

  /**
   * 예전에는 `FISH_REFERENCE_ID`(운영자 목소리)를 "내목소리"라는 이름으로 목록 맨 앞에 끼워
   * 넣었다. 모든 수강생의 기본 선택이 운영자 목소리가 됐다는 뜻이다.
   */
  it('never injects the operator env voice into a student list', async () => {
    await store.write('fish-voices', [voice('mine', 'u1')]);
    process.env.FISH_REFERENCE_ID = 'operator-voice';
    vi.resetModules();
    try {
      const { GET } = await import('../voicebox/profiles/route');
      const res = await GET(new Request('http://localhost/api/voicebox/profiles', {
        headers: cookieFor('u1'),
      }));
      const body = await res.json();
      const ids = body.profiles.map((p: { id: string }) => p.id);
      expect(ids).toEqual(['mine']);
      expect(ids).not.toContain('operator-voice');
      expect(body.profiles.map((p: { name: string }) => p.name)).not.toContain('내목소리');
    } finally {
      delete process.env.FISH_REFERENCE_ID;
      vi.resetModules();
    }
  });
});

describe('POST /api/voicebox/clone', () => {
  /**
   * `lib/env.ts`는 import 시점에 `process.env`를 스냅샷한다 — beforeEach에서 키를 넣어도
   * 이미 늦다. 키를 세운 뒤 모듈을 새로 읽어야 실제 클론 경로까지 도달한다.
   */
  async function loadCloneRoute() {
    process.env.FISH_API_KEY = 'test-fish-key';
    vi.resetModules();
    return (await import('../voicebox/clone/route')).POST;
  }

  function cloneReq(studentId?: string) {
    const form = new FormData();
    form.append('sample', new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/wav' }), 'me.wav');
    form.append('name', '내 목소리');
    form.append('language', 'ko');
    form.append('referenceText', '안녕하세요 오늘 수업 팁을 알려드릴게요.');
    return new Request('http://localhost/api/voicebox/clone', {
      method: 'POST',
      headers: studentId ? cookieFor(studentId) : {},
      body: form,
    });
  }

  function stubFishModelApi(modelId: string) {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ _id: modelId, title: '내 목소리', languages: ['ko'], samples: [{}] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  /**
   * 세션 없는 클론은 주인 없는 목소리를 만든다. 주인이 없으면 소유자 필터를 통과할 수
   * 없으니 아무에게도 안 보이는 유령이 되거나, 더 나쁘게는 모두에게 보이게 된다.
   */
  it('rejects a clone with no session', async () => {
    const fetchMock = stubFishModelApi('voice_x');
    const cloneRoute = await loadCloneRoute();
    const res = await cloneRoute(cloneReq());
    expect(res.status).toBe(401);
    // 인증 전에 Fish Audio를 호출해서 크레딧을 태우지도 않는다.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a forged session cookie', async () => {
    stubFishModelApi('voice_x');
    const cloneRoute = await loadCloneRoute();
    const res = await cloneRoute(new Request('http://localhost/api/voicebox/clone', {
      method: 'POST',
      headers: { cookie: 'student_session=u1' },
      body: new FormData(),
    }));
    expect(res.status).toBe(401);
  });

  it('records the caller as the owner of the cloned voice', async () => {
    stubFishModelApi('voice_u1');
    const cloneRoute = await loadCloneRoute();
    const res = await cloneRoute(cloneReq('u1'));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('voice_u1');

    const stored = await store.read<FishVoiceProfile[]>('fish-voices', []);
    expect(stored).toHaveLength(1);
    expect(stored[0].ownerId).toBe('u1');
  });

  // 소유자를 기록만 하고 필터가 그걸 안 쓰면 의미가 없다. 반대편까지 확인한다.
  it('makes the clone visible to its owner and to nobody else', async () => {
    stubFishModelApi('voice_u1');
    const cloneRoute = await loadCloneRoute();
    await cloneRoute(cloneReq('u1'));
    expect((await listFishVoices('u1')).map((v) => v.id)).toEqual(['voice_u1']);
    expect(await listFishVoices('u2')).toEqual([]);
  });
});
