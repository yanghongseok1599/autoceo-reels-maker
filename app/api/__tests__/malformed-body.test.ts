import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { POST as feedbackRoute } from '../learning/feedback/route';
import { POST as importRoute } from '../learning/import/route';
import { POST as projectsRoute } from '../projects/route';
import { POST as generateRoute } from '../voicebox/generate/route';
import { POST as previewRoute } from '../voicebox/preview/start/route';
import { PATCH as jobPatchRoute } from '../jobs/[id]/route';
import { getStudent, saveStudent, signSession, type StudentAccount } from '@/lib/auth';
import { upsertFishVoice, type FishVoiceProfile } from '@/lib/fish-voice-store';
import { enqueueJob, getJob } from '@/lib/jobs';
import { getLearningInsights } from '@/lib/learning-store';

/**
 * 세션이나 워커 토큰 뒤에 있는 라우트라도 `await request.json()`을 그냥 부르면
 * **JSON이 아닌 아무 바이트나 500을 만든다.** 로그인한 수강생이 통신 오류 한 번으로
 * 500을 받고, 그 500은 로그에서 진짜 장애와 섞인다. `app/api/auth/route.ts`가 먼저
 * 이렇게 고쳐졌고 여기 여섯 라우트가 같은 구멍을 그대로 갖고 있었다.
 *
 * JSON은 멀쩡한데 **타입이 틀린** 본문도 같은 부류다 — `auth` 수정 때 `{"code": 123}`이
 * 뒤쪽 `.trim()`에서 똑같이 500을 냈다. 여섯 라우트 전부 확인해 함께 막는다.
 *
 * 각 라우트는 **이미 갖고 있는 문구**로 답한다. 못 읽은 본문에 새 문구를 만들면
 * "형식이 틀렸다"와 "값이 빠졌다"가 갈리고, 수강생에게는 어차피 같은 한 가지 할 일이다.
 */

/** JSON으로 아예 읽히지 않는 본문들. */
const UNREADABLE: (string | null)[] = ['이건 JSON이 아닙니다', '{"script": "대본"', '', null, '%%%'];

/** `JSON.parse`는 통과하지만 이름 있는 필드를 읽을 수 없는 값들. */
const NOT_AN_OBJECT = ['null', '"대본"', '123', '[]', 'true'];

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
  process.env.WORKER_TOKEN = 'test-token';
  process.env.PUBLIC_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-public-'));
  // 저장소는 `vitest.setup.ts`가 테스트마다 새 `STORE_DIR`을 준다.
  await saveStudent(student('u1'));
  await upsertFishVoice(voice('mine', 'u1'));
});

const cookie = (id: string) => ({ cookie: `student_session=${encodeURIComponent(signSession(id))}` });

const post = (url: string, body: BodyInit | null, headers: Record<string, string>) =>
  new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body });

/**
 * 한 라우트가 **어떤 망가진 본문에도** 자기 400으로 답하는지 한 번에 확인한다.
 * 500이 하나라도 새면 여기서 실패한다.
 */
function rejectsEveryBrokenBody(
  name: string,
  send: (body: BodyInit | null) => Promise<Response>,
  expected: { status: number; error: string },
  wrongTypes: string[],
) {
  describe(name, () => {
    it('JSON이 아닌 본문·끊긴 JSON·빈 본문·본문 없음을 500이 아니라 자기 400으로 거절한다', async () => {
      for (const body of UNREADABLE) {
        const res = await send(body);
        expect(res.status, `본문: ${JSON.stringify(body)}`).toBe(expected.status);
        expect((await res.json()).error).toBe(expected.error);
      }
    });

    it('객체가 아닌 JSON(null·문자열·숫자·배열·불리언)도 같은 400으로 거절한다', async () => {
      for (const body of NOT_AN_OBJECT) {
        const res = await send(body);
        expect(res.status, `본문: ${body}`).toBe(expected.status);
        expect((await res.json()).error).toBe(expected.error);
      }
    });

    if (wrongTypes.length > 0) {
      it('JSON은 멀쩡한데 필드 타입이 틀린 본문도 500이 아니라 400이다', async () => {
        for (const body of wrongTypes) {
          const res = await send(body);
          expect(res.status, `본문: ${body}`).toBe(expected.status);
          expect((await res.json()).error).toBe(expected.error);
        }
      });
    }
  });
}

rejectsEveryBrokenBody(
  'POST /api/learning/feedback — 망가진 본문',
  (body) => feedbackRoute(post('http://localhost/api/learning/feedback', body, cookie('u1'))),
  { status: 400, error: '평가 값이 필요합니다.' },
  ['{"feedback": 123}', '{"feedback": null}', '{"feedback": ["good"]}'],
);

rejectsEveryBrokenBody(
  'POST /api/learning/import — 망가진 본문',
  (body) => importRoute(post('http://localhost/api/learning/import', body, cookie('u1'))),
  { status: 400, error: '지원하지 않는 포맷입니다.' },
  ['{"format": 123}', '{"format": null}'],
);

/** 포맷은 맞는데 `script`가 문자열이 아닌 경우 — `payload.script?.trim()`이 터지던 자리. */
describe('POST /api/learning/import — 문자열 자리에 온 다른 타입', () => {
  const send = (body: string) =>
    importRoute(post('http://localhost/api/learning/import', body, cookie('u1')));

  it('script가 문자열이 아니면 500이 아니라 "프롬프트가 필요합니다."다', async () => {
    for (const script of ['123', 'null', '{}', '["대본"]', 'true']) {
      const res = await send(`{"format": "format_a", "script": ${script}, "resultFileName": "r.mp4"}`);
      expect(res.status, `script: ${script}`).toBe(400);
      expect((await res.json()).error).toBe('프롬프트가 필요합니다.');
    }
  });

  it('resultFileName이 문자열이 아니면 500이 아니라 그 자리의 400이다', async () => {
    for (const name of ['123', 'null', '{}', '["r.mp4"]']) {
      const res = await send(`{"format": "format_a", "script": "대본", "resultFileName": ${name}}`);
      expect(res.status, `resultFileName: ${name}`).toBe(400);
      expect((await res.json()).error).toBe('완성된 MP4 파일명이 필요합니다.');
    }
  });

  /**
   * 공백만 든 값은 빈 값과 같다. `.trim()`이 빠지면 `"   "`가 대본으로 통과해
   * 빈 프롬프트로 학습 기록이 만들어진다 — 400 가드가 **실제로 눌리는지**의 증거다.
   */
  it('공백만 든 script는 400이다', async () => {
    const res = await send('{"format": "format_a", "script": "   ", "resultFileName": "r.mp4"}');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('프롬프트가 필요합니다.');
  });

  it('공백만 든 resultFileName도 400이다', async () => {
    const res = await send('{"format": "format_a", "script": "대본", "resultFileName": "  "}');
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('완성된 MP4 파일명이 필요합니다.');
  });

  /** `uniqueCompact`가 항목마다 `.trim()`을 부른다 — 숫자 하나로 500이 났다. */
  it('referenceNames에 문자열이 아닌 항목이 섞여도 500 없이 기록을 만든다', async () => {
    const res = await send(
      '{"format": "format_a", "script": "대본", "resultFileName": "r.mp4", "referenceNames": ["샘플", 1, null]}',
    );
    expect(res.status).toBe(200);
    expect((await res.json()).record.referenceNames).toEqual(['샘플']);
  });

  it('referenceNames가 배열이 아니어도 500 없이 기록을 만든다', async () => {
    const res = await send(
      '{"format": "format_a", "script": "대본", "resultFileName": "r.mp4", "referenceNames": "샘플"}',
    );
    expect(res.status).toBe(200);
    expect((await res.json()).record.referenceNames).toEqual([]);
  });
});

rejectsEveryBrokenBody(
  'POST /api/projects — 망가진 본문',
  (body) => projectsRoute(post('http://localhost/api/projects', body, cookie('u1'))),
  { status: 400, error: '대본을 입력해주세요.' },
  ['{"script": 123}', '{"script": null}', '{"script": {}}', '{"script": ["대본"]}'],
);

/**
 * `voiceReferenceId`가 문자열이 아니면 `authorizeVoice`의 `voiceId?.trim()`이 터졌다.
 * 여기서는 "목소리를 선택해주세요"가 나와야 한다 — 그 검사가 이미 하는 말이다.
 */
describe('POST /api/projects — voiceReferenceId 타입', () => {
  it('문자열이 아니면 500이 아니라 목소리 선택 400이다', async () => {
    for (const id of ['123', '{}', '["mine"]', 'true']) {
      const res = await projectsRoute(post(
        'http://localhost/api/projects',
        `{"script": "대본", "voiceReferenceId": ${id}}`,
        cookie('u1'),
      ));
      expect(res.status, `voiceReferenceId: ${id}`).toBe(400);
      expect((await res.json()).error).toBe('사용할 목소리를 선택해주세요.');
    }
  });

  /** 400에서 멈췄으면 이번 달 생성 횟수를 깎으면 안 된다. */
  it('망가진 본문으로는 생성 한도를 차감하지 않는다', async () => {
    await projectsRoute(post('http://localhost/api/projects', '망가진 본문', cookie('u1')));
    expect((await getStudent('u1'))?.monthlyRenderCount).toBe(0);
  });
});

rejectsEveryBrokenBody(
  'POST /api/voicebox/generate — 망가진 본문',
  (body) => generateRoute(post('http://localhost/api/voicebox/generate', body, cookie('u1'))),
  { status: 400, error: 'text is required' },
  ['{"text": 123}', '{"text": null}', '{"text": {}}', '{"text": ["안녕"]}'],
);

rejectsEveryBrokenBody(
  'POST /api/voicebox/preview/start — 망가진 본문',
  (body) => previewRoute(post('http://localhost/api/voicebox/preview/start', body, cookie('u1'))),
  { status: 400, error: 'text is required' },
  ['{"text": 123}', '{"text": null}', '{"text": {}}', '{"text": ["안녕"]}'],
);

/**
 * `profileId`가 문자열이 아니면 `authorizeVoice`의 `voiceId?.trim()`이 터졌다.
 * 목소리를 하나도 등록하지 않은 수강생은 그 앞에서 걸러지므로, **목소리를 가진**
 * 수강생으로 불러야 그 자리에 닿는다.
 */
describe.each([
  ['POST /api/voicebox/generate', generateRoute],
  ['POST /api/voicebox/preview/start', previewRoute],
])('%s — profileId 타입', (_name, route) => {
  it('문자열이 아니면 500이 아니라 "profileId is required"다', async () => {
    for (const id of ['123', '{}', '["mine"]', 'true']) {
      const res = await route(post(
        'http://localhost/api/voicebox/synth',
        `{"text": "안녕하세요", "profileId": ${id}}`,
        cookie('u1'),
      ));
      expect(res.status, `profileId: ${id}`).toBe(400);
      expect((await res.json()).error).toBe('profileId is required');
    }
  });
});

/**
 * 잡 갱신만 답이 다르다. 나머지 다섯은 못 읽은 본문을 "빈 요청"으로 보고 이미 있는 400을
 * 태우면 되지만, 여기서는 **빈 패치가 곧 성공**이다 — `{...job, ...{}}`는 잡을 그대로
 * 다시 쓰고 200을 낸다. 실제로 `null`·`123`·`"x"`·`[]`가 전부 조용히 200을 받았다.
 */
describe('PATCH /api/jobs/[id] — 망가진 본문', () => {
  const patch = async (id: string, body: BodyInit | null) =>
    jobPatchRoute(
      new Request(`http://localhost/api/jobs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-worker-token': 'test-token' },
        body,
      }),
      { params: Promise.resolve({ id }) },
    );

  it('읽을 수 없는 본문을 500도 200도 아닌 400으로 거절한다', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    for (const body of UNREADABLE) {
      const res = await patch(job.id, body);
      expect(res.status, `본문: ${JSON.stringify(body)}`).toBe(400);
      expect((await res.json()).error).toBe('작업 갱신 내용을 읽을 수 없습니다.');
    }
  });

  it('객체가 아닌 JSON을 조용한 200이 아니라 400으로 거절한다', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    for (const body of NOT_AN_OBJECT) {
      const res = await patch(job.id, body);
      expect(res.status, `본문: ${body}`).toBe(400);
    }
  });

  it('거절된 갱신은 잡을 건드리지 않는다', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    await patch(job.id, '망가진 본문');
    const stored = await getJob(job.id);
    expect(stored?.status).toBe('queued');
    expect(stored?.progress).toBe(0);
  });

  /** 인증이 먼저다 — 망가진 본문이 워커 검사를 앞지르지 않는다. */
  it('토큰이 없으면 본문을 보기 전에 401이다', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await jobPatchRoute(
      new Request(`http://localhost/api/jobs/${job.id}`, { method: 'PATCH', body: '망가진 본문' }),
      { params: Promise.resolve({ id: job.id }) },
    );
    expect(res.status).toBe(401);
  });

  it('멀쩡한 패치는 그대로 통한다', async () => {
    const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
    const res = await patch(job.id, JSON.stringify({ status: 'rendering', progress: 42 }));
    expect(res.status).toBe(200);
    expect((await getJob(job.id))?.progress).toBe(42);
  });
});

/** 망가진 요청 뒤에도 앱은 멀쩡하다 — 라우트가 저장소를 망가뜨리지 않는다. */
describe('망가진 본문은 아무것도 남기지 않는다', () => {
  it('거절된 import는 학습 기록을 만들지 않는다', async () => {
    await importRoute(post('http://localhost/api/learning/import', '망가진 본문', cookie('u1')));
    expect((await getLearningInsights('u1', 'format_a')).total).toBe(0);
  });

  it('망가진 요청 다음에도 정상 import는 그대로 된다', async () => {
    await importRoute(post('http://localhost/api/learning/import', '%%%', cookie('u1')));
    const res = await importRoute(post(
      'http://localhost/api/learning/import',
      JSON.stringify({ format: 'format_a', script: '대본', resultFileName: 'r.mp4' }),
      cookie('u1'),
    ));
    expect(res.status).toBe(200);
    expect((await res.json()).record.script).toBe('대본');
  });
});
