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
 * `BLOB_READ_WRITE_TOKEN`은 **필수가 아니다.** 없으면 `lib/store/index.ts`가 파일 저장소를
 * 고르고 앱은 그대로 동작한다 — 그게 로컬 개발 구성이다. 다만 Vercel의 파일시스템은
 * 요청 사이에 남지 않으므로 배포에서는 데이터가 조용히 사라진다. "동작은 하는데 배포에는
 * 틀린" 값이라 `recommended`로 따로 보고하고, 이 값 때문에 헬스가 실패하지는 않는다.
 */
export const REQUIRED_APP_ENV = ['SESSION_SECRET', 'WORKER_TOKEN', 'FISH_API_KEY'] as const;

/** 없어도 앱은 돈다. 배포에서만 문제가 되므로 `missing`과 섞지 않는다. */
export const RECOMMENDED_APP_ENV = ['BLOB_READ_WRITE_TOKEN'] as const;

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
  return absent(REQUIRED_APP_ENV, env);
}

export function missingRecommendedAppEnv(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return absent(RECOMMENDED_APP_ENV, env);
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
