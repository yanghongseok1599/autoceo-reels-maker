import { describe, it, expect, beforeEach } from 'vitest';
import { GET as healthRoute, REQUIRED_APP_ENV, RECOMMENDED_APP_ENV } from '../health/route';

/**
 * 이 라우트의 값어치는 전부 **누구에게 어떤 이름을 보여주는가**에 있다. 그래서 검사도
 * 두 갈래다: (1) 인증 없는 쪽이 이름을 하나도 못 얻는가, (2) 워커 토큰을 가진 쪽이
 * 실제로 빠진 이름을 얻는가. 그리고 양쪽 모두 **값은 절대 싣지 않는가**.
 *
 * `BLOB_READ_WRITE_TOKEN`은 `vitest.setup.ts`가 파일 최상단에서 지운다(배포용 Blob
 * 구현체가 선택되지 않게 하려고). 그 값이 필요한 검사는 여기서 직접 세운다.
 */
const WORKER_TOKEN = 'worker-token-for-health';

// 값이 응답에 새는지 보려면 값 자체가 눈에 띄어야 한다. 이름과 겹치지 않는 문자열을 쓴다.
const SECRET_VALUE = 'zzz-session-secret-value-zzz';
const FISH_VALUE = 'zzz-fish-key-value-zzz';
const BLOB_VALUE = 'zzz-blob-token-value-zzz';

beforeEach(() => {
  process.env.SESSION_SECRET = SECRET_VALUE;
  process.env.WORKER_TOKEN = WORKER_TOKEN;
  process.env.FISH_API_KEY = FISH_VALUE;
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

const call = (token?: string) =>
  healthRoute(
    new Request('http://localhost/api/health', {
      headers: token === undefined ? {} : { 'x-worker-token': token },
    }),
  );

const read = async (token?: string) => {
  const res = await call(token);
  const body = await res.json();
  // 본문을 통째로 문자열로 본다 — 어느 키에 숨어 있든 이름/값이 새면 걸린다.
  return { status: res.status, body, text: JSON.stringify(body) };
};

describe('GET /api/health — 인증 없는 호출은 이름을 하나도 알려주지 않는다', () => {
  it('모두 갖춰졌으면 200 { ok: true } 하나만 준다', async () => {
    const { status, body } = await read();
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it('빠진 것이 있으면 200이 아니고, 본문은 { ok: false } 하나뿐이다', async () => {
    delete process.env.SESSION_SECRET;
    const { status, body } = await read();
    expect(status).not.toBe(200);
    expect(status).toBe(503);
    expect(body).toEqual({ ok: false });
  });

  /** 이 검사가 이 라우트를 만든 이유의 반대편이다. 이름이 하나라도 새면 실패해야 한다. */
  it('빠진 변수의 **이름**을 응답 어디에도 싣지 않는다', async () => {
    delete process.env.SESSION_SECRET;
    delete process.env.FISH_API_KEY;
    const { text } = await read();
    for (const name of [...REQUIRED_APP_ENV, ...RECOMMENDED_APP_ENV]) {
      expect(text).not.toContain(name);
    }
    expect(text).not.toContain('missing');
    expect(text).not.toContain('recommended');
  });

  it('워커 토큰이 틀리면 인증 없는 호출과 똑같이 답한다', async () => {
    delete process.env.SESSION_SECRET;
    const wrong = await read('not-the-worker-token');
    expect(wrong.status).toBe(503);
    expect(wrong.body).toEqual({ ok: false });
    expect(wrong.text).not.toContain('SESSION_SECRET');
  });

  it('빈 워커 토큰 헤더로도 이름을 얻지 못한다', async () => {
    delete process.env.SESSION_SECRET;
    const { body, text } = await read('');
    expect(body).toEqual({ ok: false });
    expect(text).not.toContain('SESSION_SECRET');
  });

  /**
   * `WORKER_TOKEN` 자체가 비면 `assertWorker`는 무조건 false다 — 아무 토큰을 들고 와도
   * 이름 목록은 못 본다. 그 상태에서 헤더를 흉내 내 이름을 긁어낼 수 없다는 것을 못 박는다.
   */
  it('WORKER_TOKEN이 비어 있으면 어떤 헤더로도 이름을 얻지 못한다', async () => {
    delete process.env.WORKER_TOKEN;
    for (const attempt of [undefined, '', 'anything']) {
      const { status, body } = await read(attempt);
      expect(status).toBe(503);
      expect(body).toEqual({ ok: false });
    }
  });
});

describe('GET /api/health — 워커 토큰을 가진 쪽은 빠진 이름을 받는다', () => {
  it('모두 갖춰졌으면 200과 빈 목록을 준다', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = BLOB_VALUE;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, missing: [], recommended: [] });
  });

  it('SESSION_SECRET이 없으면 그 이름을 집어 준다', async () => {
    delete process.env.SESSION_SECRET;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.missing).toEqual(['SESSION_SECRET']);
  });

  it('여러 개가 빠지면 하나만 말하고 멈추지 않는다', async () => {
    delete process.env.SESSION_SECRET;
    delete process.env.FISH_API_KEY;
    const { body } = await read(WORKER_TOKEN);
    expect(body.missing).toEqual(['SESSION_SECRET', 'FISH_API_KEY']);
  });

  it('FISH_API_KEY만 빠져도 잡아낸다 — SESSION_SECRET 전용 검사가 아니다', async () => {
    delete process.env.FISH_API_KEY;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(503);
    expect(body.missing).toEqual(['FISH_API_KEY']);
  });

  /** 공백만 든 값은 없는 것과 같다. `.trim()`이 빠지면 이 검사가 죽는다. */
  it('공백만 들어 있는 값은 없는 것으로 센다', async () => {
    process.env.SESSION_SECRET = '   ';
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(503);
    expect(body.missing).toEqual(['SESSION_SECRET']);
  });

  it('빈 문자열도 없는 것으로 센다', async () => {
    process.env.FISH_API_KEY = '';
    expect((await read(WORKER_TOKEN)).body.missing).toEqual(['FISH_API_KEY']);
  });

  /**
   * **값은 절대 나가지 않는다.** 이름만으로 운영자는 무엇을 채울지 알 수 있고,
   * 값이 새면 지금 막으려는 문제보다 나쁜 사고가 된다.
   */
  it('가진 값도 빠진 값도 응답에 실리지 않는다 — 이름뿐이다', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = BLOB_VALUE;
    process.env.SESSION_SECRET = '   ';
    const { text } = await read(WORKER_TOKEN);
    expect(text).toContain('SESSION_SECRET');
    for (const value of [SECRET_VALUE, FISH_VALUE, BLOB_VALUE, WORKER_TOKEN]) {
      expect(text).not.toContain(value);
    }
  });

  /** 소유자 경계를 넓히지 않는다 — 헬스가 수강생에 대해 알려 주는 통로가 되면 안 된다. */
  it('환경변수 이름 말고는 아무것도 담지 않는다', async () => {
    delete process.env.SESSION_SECRET;
    const { body } = await read(WORKER_TOKEN);
    expect(Object.keys(body).sort()).toEqual(['missing', 'ok', 'recommended']);
    const known: readonly string[] = [...REQUIRED_APP_ENV, ...RECOMMENDED_APP_ENV];
    for (const name of [...body.missing, ...body.recommended]) {
      expect(known).toContain(name);
    }
  });
});

describe('GET /api/health — BLOB_READ_WRITE_TOKEN은 권장이지 필수가 아니다', () => {
  /** 없어도 앱은 돈다(파일 저장소). 이걸로 헬스를 실패시키면 로컬 개발이 늘 빨개진다. */
  it('없어도 ok는 true이고 상태는 200이다', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.missing).toEqual([]);
  });

  /** 그래도 배포에서는 데이터가 사라진다. missing과 **다른 자리**로 말해 준다. */
  it('없으면 recommended에 이름이 뜬다', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { body } = await read(WORKER_TOKEN);
    expect(body.recommended).toEqual(['BLOB_READ_WRITE_TOKEN']);
    expect(body.missing).not.toContain('BLOB_READ_WRITE_TOKEN');
  });

  it('있으면 recommended가 빈다', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = BLOB_VALUE;
    expect((await read(WORKER_TOKEN)).body.recommended).toEqual([]);
  });

  it('공백만 들어 있으면 없는 것으로 센다', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = '  ';
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(200);
    expect(body.recommended).toEqual(['BLOB_READ_WRITE_TOKEN']);
  });
});

describe('필수 목록 자체', () => {
  /**
   * 목록에 든 이름은 전부 "없으면 무엇이 깨지는가"를 말할 수 있어야 한다(라우트 주석).
   * 목록이 조용히 늘거나 줄면 여기서 걸린다.
   */
  it('앱이 실제로 죽는 세 가지만 필수다', () => {
    expect([...REQUIRED_APP_ENV]).toEqual(['SESSION_SECRET', 'WORKER_TOKEN', 'FISH_API_KEY']);
  });

  it('BLOB_READ_WRITE_TOKEN은 필수가 아니라 권장 쪽에 있다', () => {
    expect([...REQUIRED_APP_ENV]).not.toContain('BLOB_READ_WRITE_TOKEN');
    expect([...RECOMMENDED_APP_ENV]).toEqual(['BLOB_READ_WRITE_TOKEN']);
  });

  /** 워커 전용 변수는 앱 필수가 아니다 — 앱은 WHISPER 없이도 멀쩡히 돈다. */
  it('워커에서만 쓰는 변수를 앱 필수에 섞지 않는다', () => {
    for (const workerOnly of ['WHISPER_MODEL', 'WHISPER_BIN', 'APP_URL']) {
      expect([...REQUIRED_APP_ENV]).not.toContain(workerOnly);
    }
  });
});
