import { describe, it, expect, beforeEach } from 'vitest';
import {
  GET as healthRoute,
  isVercelDeployment,
  REQUIRED_APP_ENV,
  DEPLOY_REQUIRED_APP_ENV,
} from '../health/route';

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
  // 기본은 **배포가 아닌 곳**이다. 실제 로컬 환경에도 이 둘은 없다(확인함).
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
});

/** Vercel 배포 환경을 흉내 낸다. 시스템 환경변수가 켜진 배포가 실제로 보내는 두 값이다. */
function onVercel(target: 'production' | 'preview' = 'production') {
  process.env.VERCEL = '1';
  process.env.VERCEL_ENV = target;
}

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
    for (const name of [...REQUIRED_APP_ENV, ...DEPLOY_REQUIRED_APP_ENV]) {
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
    const known: readonly string[] = [...REQUIRED_APP_ENV, ...DEPLOY_REQUIRED_APP_ENV];
    for (const name of [...body.missing, ...body.recommended]) {
      expect(known).toContain(name);
    }
  });
});

/**
 * `ok: true`가 거짓말을 할 수 있으면 헬스는 **없는 것보다 나쁘다.** 초록불을 받은 운영자는
 * 그때부터 다른 데를 보기 때문이다. 저장소 토큰이 빠진 Vercel 배포는 수강생의 목소리·
 * 캐릭터·프로젝트를 전부 잃는데, 예전에는 거기에 `ok: true`가 나갔다.
 *
 * 네 모서리를 전부 못 박는다: (배포 여부) × (토큰 유무).
 */
describe('GET /api/health — BLOB_READ_WRITE_TOKEN은 배포에서만 필수다', () => {
  it('① 배포 + 토큰 있음 → ok', async () => {
    onVercel();
    process.env.BLOB_READ_WRITE_TOKEN = BLOB_VALUE;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, missing: [], recommended: [] });
  });

  /** 이 모서리가 이번 수정의 전부다. 예전에는 여기서 200 + ok:true가 나갔다. */
  it('② 배포 + 토큰 없음 → **not ok**, 그리고 recommended가 아니라 missing에 뜬다', async () => {
    onVercel();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.missing).toContain('BLOB_READ_WRITE_TOKEN');
    // 같은 이름을 두 목록에 싣지 않는다 — recommended는 "없어도 괜찮다"는 뜻이어야 한다.
    expect(body.recommended).not.toContain('BLOB_READ_WRITE_TOKEN');
    expect(body.recommended).toEqual([]);
  });

  it('② 배포 + 토큰 없음 — 인증 없는 쪽도 ok:false를 받는다(이름은 없이)', async () => {
    onVercel();
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { status, body, text } = await read();
    expect(status).toBe(503);
    expect(body).toEqual({ ok: false });
    expect(text).not.toContain('BLOB_READ_WRITE_TOKEN');
  });

  it('③ 배포 아님 + 토큰 있음 → ok, 권장 목록도 빈다', async () => {
    process.env.BLOB_READ_WRITE_TOKEN = BLOB_VALUE;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, missing: [], recommended: [] });
  });

  /** 로컬은 파일 저장소가 진짜 디스크를 쓴다 — 대체재가 제대로 동작하는 구성이다. */
  it('④ 배포 아님 + 토큰 없음 → ok, 다만 recommended로 알려준다', async () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.missing).toEqual([]);
    expect(body.recommended).toEqual(['BLOB_READ_WRITE_TOKEN']);
  });

  it('배포에서도 공백만 든 토큰은 없는 것으로 센다', async () => {
    onVercel();
    process.env.BLOB_READ_WRITE_TOKEN = '   ';
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(503);
    expect(body.missing).toContain('BLOB_READ_WRITE_TOKEN');
  });

  /** preview 배포도 같은 서버리스 파일시스템이다. production만 보면 절반이 뚫린다. */
  it('preview 배포도 production과 똑같이 필수로 본다', async () => {
    onVercel('preview');
    delete process.env.BLOB_READ_WRITE_TOKEN;
    const { status, body } = await read(WORKER_TOKEN);
    expect(status).toBe(503);
    expect(body.missing).toContain('BLOB_READ_WRITE_TOKEN');
  });
});

/**
 * 플랫폼 판정이 **실제로 판정 노릇을 하는지**. 항상 참이면 로컬이 늘 빨개지고,
 * 항상 거짓이면 이번 수정이 통째로 없는 것과 같다.
 */
describe('isVercelDeployment — 어느 신호를 믿는가', () => {
  it('production과 preview는 배포다', () => {
    expect(isVercelDeployment({ VERCEL_ENV: 'production' })).toBe(true);
    expect(isVercelDeployment({ VERCEL_ENV: 'preview' })).toBe(true);
  });

  /** `vercel dev`는 개발자 기계다. 디스크가 진짜라 파일 저장소가 멀쩡히 동작한다. */
  it('vercel dev(VERCEL=1 + VERCEL_ENV=development)는 배포가 아니다', () => {
    expect(isVercelDeployment({ VERCEL: '1', VERCEL_ENV: 'development' })).toBe(false);
  });

  it('아무 신호도 없으면 배포가 아니다', () => {
    expect(isVercelDeployment({})).toBe(false);
    expect(isVercelDeployment({ VERCEL: '', VERCEL_ENV: '' })).toBe(false);
  });

  /** 공백만 든 값은 없는 것과 같다 — 다른 필수 검사와 같은 기준을 쓴다. */
  it('공백만 든 신호는 신호가 아니다', () => {
    expect(isVercelDeployment({ VERCEL: '   ' })).toBe(false);
    expect(isVercelDeployment({ VERCEL_ENV: '  ' })).toBe(false);
  });

  it('앞뒤 공백이 붙은 VERCEL_ENV도 알아본다', () => {
    expect(isVercelDeployment({ VERCEL_ENV: ' production ' })).toBe(true);
    expect(isVercelDeployment({ VERCEL: '1', VERCEL_ENV: ' development ' })).toBe(false);
  });

  /**
   * 시스템 환경변수를 일부만 노출한 배포. 모르면 **배포로 본다** — 틀리는 방향은
   * "괜히 빨개진다"여야지 "깨진 배포에 초록불"이면 안 된다.
   */
  it('VERCEL만 있고 VERCEL_ENV가 없으면 배포로 본다(fail-closed)', () => {
    expect(isVercelDeployment({ VERCEL: '1' })).toBe(true);
  });

  /** `VERCEL_ENV`를 먼저 본다 — `VERCEL`이 붙어 있어도 development면 배포가 아니다. */
  it('VERCEL_ENV가 VERCEL보다 우선한다', () => {
    expect(isVercelDeployment({ VERCEL: '1', VERCEL_ENV: 'development' })).toBe(false);
    expect(isVercelDeployment({ VERCEL_ENV: 'production' })).toBe(true);
  });

  it('실제 process.env를 기본값으로 읽는다', () => {
    expect(isVercelDeployment()).toBe(false);
    onVercel();
    expect(isVercelDeployment()).toBe(true);
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

  it('BLOB_READ_WRITE_TOKEN은 무조건 필수가 아니라 배포 조건부다', () => {
    expect([...REQUIRED_APP_ENV]).not.toContain('BLOB_READ_WRITE_TOKEN');
    expect([...DEPLOY_REQUIRED_APP_ENV]).toEqual(['BLOB_READ_WRITE_TOKEN']);
  });

  /** 워커 전용 변수는 앱 필수가 아니다 — 앱은 WHISPER 없이도 멀쩡히 돈다. */
  it('워커에서만 쓰는 변수를 앱 필수에 섞지 않는다', () => {
    for (const workerOnly of ['WHISPER_MODEL', 'WHISPER_BIN', 'APP_URL']) {
      expect([...REQUIRED_APP_ENV]).not.toContain(workerOnly);
    }
  });
});
