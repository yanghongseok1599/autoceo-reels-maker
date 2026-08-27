import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GET as profilesRoute } from '../voicebox/profiles/route';
import { signSession } from '@/lib/auth';
import { store } from '@/lib/store';
import {
  listFishVoices, upsertFishVoice, type FishVoiceProfile,
} from '@/lib/fish-voice-store';

const voice = (id: string, ownerId: string): FishVoiceProfile => ({
  id, ownerId, name: `${ownerId}의 목소리`, language: 'ko', sampleCount: 1,
  createdAt: '2026-08-26T00:00:00Z',
});

/**
 * 목소리는 이제 소유자별 키(`fish-voices/<ownerId>`)에 들어간다. 예전처럼 공유 배열
 * 하나에 심어 두면 라우트는 **없는 키의 fallback**을 읽어, 무엇을 심었든 늘 빈 목록을
 * 보게 된다 — 경계 검사가 통과만 하는 빈 검사로 조용히 바뀐다. 그래서 저장소 모양을
 * 여기서 다시 적지 않고 실제 저장 경로로 심는다.
 */
async function seed(...voices: FishVoiceProfile[]) {
  for (const v of voices) await upsertFishVoice(v);
}

beforeEach(async () => {
  process.env.SESSION_SECRET = 'test-session-secret';
  process.env.FISH_API_KEY = 'test-fish-key';
  // 합성 결과 mp3가 저장소의 실제 public/으로 새어 나가지 않게 한다.
  process.env.PUBLIC_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-public-'));
  // 저장소는 `vitest.setup.ts`가 테스트마다 새 `STORE_DIR`을 주므로 따로 비울 것이 없다.
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
    await seed(voice('mine', 'u1'), voice('theirs', 'u2'));
    const { status, body } = await list('u1');
    expect(status).toBe(200);
    expect(body.profiles.map((p: { id: string }) => p.id)).toEqual(['mine']);
  });

  it('gives each student their own list', async () => {
    await seed(voice('mine', 'u1'), voice('theirs', 'u2'));
    expect((await list('u2')).body.profiles.map((p: { id: string }) => p.id)).toEqual(['theirs']);
  });

  it('returns an empty list for a student who has cloned nothing', async () => {
    await seed(voice('theirs', 'u2'));
    // u2에게는 실제로 목소리가 있다(`seed`가 진짜 저장 경로로 심는다). 그러니 이 빈 목록은
    // "아무것도 안 심겨서"가 아니라 소유자 경계 때문이다.
    expect((await list('u2')).body.profiles.map((p: { id: string }) => p.id)).toEqual(['theirs']);
    expect((await list('u1')).body.profiles).toEqual([]);
  });

  /**
   * 예전에는 `FISH_REFERENCE_ID`(운영자 목소리)를 "내목소리"라는 이름으로 목록 맨 앞에 끼워
   * 넣었다. 모든 수강생의 기본 선택이 운영자 목소리가 됐다는 뜻이다.
   */
  it('never injects the operator env voice into a student list', async () => {
    await seed(voice('mine', 'u1'));
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

    // 호출자의 키를 직접 본다. 공유 키를 읽으면 이제 없는 키의 fallback이 와서
    // 라우트가 무엇을 저장했든 통과하는 빈 검사가 된다.
    const stored = await store.read<FishVoiceProfile[]>('fish-voices/u1', []);
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


/**
 * 합성 라우트 — 여기가 진짜 사칭 지점이다.
 *
 * 목록을 막아도 이 두 라우트가 열려 있으면 id를 아는 사람은 누구나(로그인조차 없이)
 * 남의 클론 목소리로 아무 문장이나 만들 수 있다.
 */
describe.each([
  ['POST /api/voicebox/preview/start', '../voicebox/preview/start/route'],
  ['POST /api/voicebox/generate', '../voicebox/generate/route'],
])('%s — voice ownership', (_name, modulePath) => {
  /** `lib/env.ts`가 import 시점에 env를 스냅샷하므로 키를 세운 뒤 새로 읽어야 한다. */
  async function loadRoute() {
    process.env.FISH_API_KEY = 'test-fish-key';
    vi.resetModules();
    return (await import(modulePath)).POST as (req: Request) => Promise<Response>;
  }

  /** TTS 응답(mp3 바이트). 소유권을 통과한 요청만 여기까지 온다. */
  function stubFishTts() {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit = {}) =>
      new Response(new Uint8Array([0xff, 0xfb, 0x00]), {
        status: 200, headers: { 'Content-Type': 'audio/mpeg' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  const body = (profileId: string) => ({
    text: '안녕하세요, 오늘 수업 팁을 알려드릴게요.', profileId, language: 'ko',
  });

  function req(profileId: string, studentId?: string) {
    return new Request('http://localhost/api/voicebox/synth', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(studentId ? cookieFor(studentId) : {}),
      },
      body: JSON.stringify(body(profileId)),
    });
  }

  beforeEach(async () => {
    await seed(voice('mine', 'u1'), voice('theirs', 'u2'));
  });

  it('rejects an unauthenticated request', async () => {
    const fetchMock = stubFishTts();
    const POST = await loadRoute();
    const res = await POST(req('mine'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('로그인이 필요합니다.');
    // 인증 전에 Fish Audio를 호출해 크레딧을 태우지도, 오디오를 만들지도 않는다.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a forged session cookie', async () => {
    stubFishTts();
    const POST = await loadRoute();
    const res = await POST(new Request('http://localhost/api/voicebox/synth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', cookie: 'student_session=u1' },
      body: JSON.stringify(body('mine')),
    }));
    expect(res.status).toBe(401);
  });

  /**
   * 핵심. 이 검사를 지우면 u1이 u2의 목소리로 문장을 합성하고 200을 받는다.
   */
  it("refuses to synthesize in another student's voice", async () => {
    const fetchMock = stubFishTts();
    const POST = await loadRoute();
    const res = await POST(req('theirs', 'u1'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('사용할 수 없는');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an unknown voice id the same way it refuses someone else\'s', async () => {
    stubFishTts();
    const POST = await loadRoute();
    const res = await POST(req('no-such-voice', 'u1'));
    expect(res.status).toBe(400);
    // 남의 것과 없는 것을 구분해 답하면 그 id가 실재한다는 걸 알려주는 셈이다.
    expect((await res.json()).error).toContain('사용할 수 없는');
  });

  /**
   * 아무것도 클론하지 않은 수강생이다. 예전에는 공유 배열을 덮어써서 u1의 목소리를
   * 지웠지만, 키가 나뉜 지금은 남의 키를 덮어 지우는 방법이 없다(그게 이 변경의 요점이다).
   * 그래서 애초에 심지 않은 수강생으로 부른다 — 저장소 모양과 무관한 검사가 된다.
   */
  it('refuses when the caller has registered no voice at all', async () => {
    stubFishTts();
    const POST = await loadRoute();
    const res = await POST(req('theirs', 'u3'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('목소리를 먼저 등록');
  });

  it('still synthesizes for the owner of the voice', async () => {
    const fetchMock = stubFishTts();
    const POST = await loadRoute();
    const res = await POST(req('mine', 'u1'));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // 학생이 고른 목소리로 합성해야 한다 — 통과만 시키고 다른 id를 쓰면 소용없다.
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(sent.reference_id).toBe('mine');
  });

  it('lets the other student use their own voice', async () => {
    stubFishTts();
    const POST = await loadRoute();
    expect((await POST(req('theirs', 'u2'))).status).toBe(200);
    expect((await POST(req('mine', 'u2'))).status).toBe(400);
  });

  it('keeps the existing 400 for a missing text or profileId', async () => {
    const POST = await loadRoute();
    const send = (payload: unknown) => POST(new Request('http://localhost/api/voicebox/synth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...cookieFor('u1') },
      body: JSON.stringify(payload),
    }));
    expect((await send({ profileId: 'mine' })).status).toBe(400);
    expect((await send({ text: '안녕하세요' })).status).toBe(400);
  });
});
