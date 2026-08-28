import { NextResponse } from 'next/server';
import { assertWorker } from '../jobs/next/route';

export const dynamic = 'force-dynamic';

/**
 * 앱 쪽 기동 환경 검사. 워커에는 이미 있었고(`worker/index.ts`의 `REQUIRED_WORKER_ENV`)
 * 앱에는 없었다 — `SESSION_SECRET` 없이 배포되면 `signSession`이 요청 시점에 던지고,
 * 운영자가 보는 것은 로그인 화면의 500 하나뿐이라 **어느 변수가 빠졌는지 알 방법이 없다.**
 *
 * 여기 올라간 이름은 전부 "없으면 무엇이 깨지는가"를 말할 수 있어야 한다:
 *
 *  · `SESSION_SECRET` — `lib/auth.ts`. `signSession`이 던져 로그인이 500이 되고,
 *    `readSession`은 아무도 통과시키지 않아 모든 인증 라우트가 401이 된다. 앱이 통째로 죽는다.
 *  · `WORKER_TOKEN`  — `app/api/jobs/next/route.ts`의 `assertWorker`가 값이 없으면
 *    무조건 false다. 워커가 잡을 영영 집어가지 못해 모든 렌더가 0%에 멈춘다.
 *  · `FISH_API_KEY`  — `lib/fish-audio-client.ts`의 `requireFishApiKey`가 던진다.
 *    `voicebox/clone`·`generate`·`preview/start`가 500이 되고, 그건 수강생이 돈을 낸
 *    바로 그 기능(내 목소리)이다.
 *
 * `BLOB_READ_WRITE_TOKEN`은 **어디서 도느냐에 따라 다르다** — 아래 `DEPLOY_REQUIRED_APP_ENV`.
 */
export const REQUIRED_APP_ENV = ['SESSION_SECRET', 'WORKER_TOKEN', 'FISH_API_KEY'] as const;

/**
 * **배포에서만** 필수다.
 *
 * 로컬에서는 없어도 된다. `lib/store/index.ts`가 파일 저장소를 고르고, 그 파일은 개발자
 * 기계의 진짜 디스크에 남는다 — 대체재가 제대로 동작하는 구성이다.
 *
 * Vercel 배포에서는 같은 말이 성립하지 않는다. 그쪽 파일시스템은 요청 사이에 남지 않으므로
 * 파일 저장소는 대체재가 아니라 **데이터 유실**이다. 수강생의 목소리·캐릭터·프로젝트가
 * 다음 요청에 사라진다.
 *
 * 그래서 이 값 하나로 헬스를 실패시키지 않던 예전 판단을 뒤집는다. 헬스가 못 해야 할 일이
 * 정확히 그것이다 — **전부 잃을 배포에 초록불을 켜 주는 것.** `ok: true`를 받은 운영자는
 * 그때부터 다른 곳을 본다. 그건 헬스가 없는 것보다 나쁘다.
 */
export const DEPLOY_REQUIRED_APP_ENV = ['BLOB_READ_WRITE_TOKEN'] as const;

/**
 * Vercel의 서버리스 파일시스템 위에서 도는가.
 *
 * 값은 확인해서 골랐다(`node_modules/next/dist` 안에서 Next 자신이 쓰는 것):
 *  · `VERCEL_ENV`는 `production` · `preview` · `development` 중 하나다.
 *    앞의 둘이 실제 배포이고, 그 파일시스템이 요청 사이에 남지 않는 바로 그것이다.
 *  · `development`는 `vercel dev` — **개발자 기계**다. 디스크가 진짜라 파일 저장소가
 *    멀쩡히 동작한다. 여기서 실패시키면 로컬이 늘 빨개지고, 빨간 게 기본이 되면
 *    아무도 안 본다.
 *  · `VERCEL`은 배포에서 `"1"`이지만 **프로젝트 설정에서 시스템 환경변수를 끄면 사라진다**
 *    (Next 주석: `process.env.VERCEL is set to "1" when System Environment Variables are
 *    exposed`). 그래서 이것만 믿지 않고 `VERCEL_ENV`를 먼저 본다.
 *
 * `VERCEL_ENV`가 없는데 `VERCEL`만 있으면 **배포로 본다.** 여기서 틀리는 방향은
 * "괜히 빨개진다"여야지 "깨진 배포에 초록불"이면 안 된다.
 *
 * 시스템 환경변수를 통째로 끈 배포는 어느 신호도 오지 않아 감지할 수 없다. 그때 이 검사는
 * 예전 동작(권장)으로 조용히 내려앉는다 — 그 한계는 `docs/OPERATIONS.md`에 적어 뒀다.
 */
export function isVercelDeployment(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const target = env.VERCEL_ENV?.trim();
  if (target === 'development') return false;
  if (target === 'production' || target === 'preview') return true;
  return Boolean(env.VERCEL?.trim());
}

/** 지금 이 환경에서 없으면 안 되는 것들. 배포에서는 저장소 토큰이 여기 합류한다. */
export function requiredAppEnv(env: Record<string, string | undefined> = process.env): string[] {
  return isVercelDeployment(env)
    ? [...REQUIRED_APP_ENV, ...DEPLOY_REQUIRED_APP_ENV]
    : [...REQUIRED_APP_ENV];
}

/**
 * 없어도 되지만 있는 편이 나은 것들. 배포에서는 저장소 토큰이 **필수로 올라갔으므로**
 * 여기서 빠진다 — 같은 이름을 두 목록에 싣지 않는다. `recommended`에 있다는 것은
 * "없어도 괜찮다"는 뜻이어야 하고, 그 뜻이 흐려지면 목록 자체가 쓸모없어진다.
 */
export function recommendedAppEnv(env: Record<string, string | undefined> = process.env): string[] {
  return isVercelDeployment(env) ? [] : [...DEPLOY_REQUIRED_APP_ENV];
}

function absent(
  names: readonly string[],
  env: Record<string, string | undefined>,
): string[] {
  // 공백만 든 값은 없는 것과 같다 — `missingWorkerEnv`와 같은 기준을 쓴다.
  return names.filter((name) => !env[name]?.trim());
}

export function missingAppEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return absent(requiredAppEnv(env), env);
}

export function missingRecommendedAppEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return absent(recommendedAppEnv(env), env);
}

/**
 * 진단용이다. `signSession`/`readSession`의 fail-closed 동작을 대신하지 않는다 —
 * 여기서 200이 나왔다고 세션이 열리는 것도, 503이 나왔다고 더 잠기는 것도 아니다.
 *
 * **이름을 누구에게 보여줄지가 이 라우트의 전부다.**
 *
 * 인증 없이 부르면 `{ ok }` 하나만 준다. 헬스 여부는 어차피 앱을 눌러 보면 드러나므로
 * 숨겨서 얻을 것이 없지만, **어느 변수가 빠졌는지는 다르다** — 그건 배포의 약한 자리를
 * 지도로 그려 주는 것이다. 이름은 워커 토큰을 가진 쪽에만 준다. `POST /api/jobs/next`가
 * 쓰는 바로 그 검사를 그대로 쓴다(두 번째 인증 수단을 만들지 않는다).
 *
 * 값은 **어느 쪽에도** 싣지 않는다. 이름만으로 운영자는 무엇을 채울지 알 수 있고,
 * 값이 새면 지금 막으려는 문제보다 나쁜 사고가 된다.
 *
 * `ok: true`는 **저장소가 진짜라는 뜻까지 포함한다.** 배포에서 `BLOB_READ_WRITE_TOKEN`이
 * 없으면 여기서 초록불이 켜지지 않는다(`DEPLOY_REQUIRED_APP_ENV` 주석).
 *
 * 저장소는 건드리지 않는다. 헬스가 수강생에 대해 알아내는 통로가 되면 안 된다.
 *
 * `WORKER_TOKEN` 자체가 비어 있으면 아무도 이름 목록을 못 본다(`assertWorker`가 false다).
 * 그 경우 운영자는 배포 콘솔에서 확인하면 된다 — 편의를 위해 경계를 열지는 않는다.
 */
export function GET(request: Request) {
  const missing = missingAppEnv();
  const ok = missing.length === 0;
  const status = ok ? 200 : 503;

  if (!assertWorker(request)) {
    return NextResponse.json({ ok }, { status });
  }

  return NextResponse.json({ ok, missing, recommended: missingRecommendedAppEnv() }, { status });
}
