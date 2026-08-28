// @ts-check

/**
 * 뮤테이션 커버리지 설정.
 *
 * 왜 있는가: 이 저장소에서 **이름이 약속한 것보다 적게 단언하는 테스트**가 세 계획에
 * 걸쳐 아홉 번 나왔고, 매번 손으로 구현을 망가뜨려 봐야만 드러났다
 * (`docs/OPERATIONS.md` — "이 저장소에서 반복된 실패 유형"). 소유자 경계 필터를
 * 통째로 지워도 아무 테스트도 실패하지 않은 적이 있다. 그 부류를 자동으로 보이게 한다.
 *
 * @type {import('@stryker-mutator/api/core').PartialStrykerOptions}
 */
const config = {
  packageManager: 'npm',
  testRunner: 'vitest',
  reporters: ['progress', 'clear-text', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },

  // 렌더 테스트를 뺀 설정. 이유는 `vitest.mutation.config.ts` 주석 참고.
  vitest: { configFile: 'vitest.mutation.config.ts' },

  // 뮤턴트마다 그 뮤턴트를 실제로 지나가는 테스트만 돌린다.
  //
  // ⚠️ 이 설정에는 **알려진 사각지대**가 하나 있다 — 리포트를 읽기 전에 반드시 알 것.
  //
  // 어느 테스트가 어느 코드를 지나가는지는 Vitest의 `related` 모드(Vite 모듈 그래프)로
  // 정한다. 그래서 **지정자가 변수인 동적 import는 따라가지 못한다.**
  // 이 저장소에 그런 자리가 정확히 한 군데 있다:
  //
  //   app/api/__tests__/voicebox-routes.test.ts:208
  //     `describe.each([...])` 안에서  await import(modulePath)
  //
  // 그 결과 아래 **두 파일에만** 유령 생존자(phantom survivor)가 생긴다:
  //
  //   app/api/voicebox/generate/route.ts       — 생존 5  (예전 36, 그중 25가 유령이었다)
  //   app/api/voicebox/preview/start/route.ts  — 생존 23 (예전 42, 그중 26이 유령이었다)
  //
  // 2026-08-29에 `app/api/__tests__/malformed-body.test.ts`가 두 라우트를 **정적으로**
  // import하면서 사각지대가 크게 줄었다(생존 36→5, 42→23). 아래 "고치려면" 항목이 말하는
  // 그 방법이 절반쯤 적용된 셈이다 — 다만 소유권 검사는 여전히 `describe.each`의 동적
  // import 쪽에만 있어서 preview는 아직 유령이 남아 있다.
  //
  // 유령이란 뜻: **테스트는 그 뮤턴트를 실제로 죽인다.** 도구가 그 테스트를 못 찾을 뿐이다.
  // 실측 확인 — `generate/route.ts`의 소유권 검사를 손으로 지우고
  // `npx vitest run app/api/__tests__/voicebox-routes.test.ts`를 돌리면 **4개가 실패한다.**
  // 대조 실행(`vitest.related = false`, 전체 스위트로 attribution) 결과 두 파일의
  // 미검출이 42→16, 36→11로 줄었고 **다른 파일은 전부 ±1 이내**였다.
  // 즉 사각지대는 이 두 파일에 한정된다.
  //
  // 그러니 저 두 파일의 낮은 점수를 "테스트가 없다"로 읽지 말 것. 남은 미검출
  // (16·11)은 진짜지만 소유권 경계가 아니라 본문 검증(text/profileId)과 응답 형태다.
  //
  // 고치려면 그 테스트가 `import(modulePath)` 대신 두 라우트를 정적으로 import하면 된다.
  // 이 과제에서는 손대지 않았다 — 테스트를 고치는 일은 별건이다.
  coverageAnalysis: 'perTest',

  mutate: [
    // 저장소·파이프라인·인증·잡·클립아트·학습·프로젝트·스타일시트·보이스.
    // 아홉 건의 사고가 전부 여기 아니면 라우트에서 났다.
    'lib/**/*.ts',
    // 세션 검사와 소유자 경계가 사는 곳.
    'app/api/**/route.ts',
    // 순수 함수(애니메이션 수학) — 뮤테이션이 싸고 신호가 선명하다.
    'packages/video/src/utils/**/*.ts',

    '!**/__tests__/**',
    '!**/*.d.ts',

    // 씬 컴포넌트와 UI는 뺀다. 그쪽 동작은 **프레임을 렌더해서** 검증하지
    // 단위 테스트로 검증하지 않는다. 뮤테이션을 걸면 발견이 아니라 잡음이 나온다.
    // (`packages/video/src/scenes/**`, `components/**` — 애초에 include에 없다.)
  ],

  ignorePatterns: [
    'chromex',
    '.local-data',
    '.next',
    'reports',
    'public/renders',
    'public/generated-audio',
    'public/clipart',
  ],

  // ── 래칫(ratchet) ────────────────────────────────────────────────────────
  // 이 값은 **래칫이다: 올리기만 한다. 절대 내리지 않는다.**
  //
  // 실측 ①(2026-08-28, 1996 뮤턴트): **62.73%** — 게이트를 처음 세운 시점
  // 실측 ②(2026-08-28, 구멍 메운 뒤): **68.49%**
  //   죽음 1377 · 타임아웃 1 · 생존 478 · 커버 안 됨 156 · 에러 0
  //   (커버된 것만 보면 74.25%)
  //   테스트 579 → 691. 뮤테이션이 지목한 구멍을 실제로 메운 결과다.
  // 실측 ③(2026-08-29, 배포 안전장치 뒤, 2077 뮤턴트): **73.62%**
  //   죽음 1528 · 타임아웃 1 · 생존 420 · 커버 안 됨 128 · 에러 0
  //   (커버된 것만 보면 78.45%)
  //   테스트 691 → 766. `GET /api/health`와 여섯 라우트의 400 가드를 넣으면서
  //   뮤턴트가 81개 늘었는데 생존은 58개 **줄었다** — 새 코드가 전부 검사에 눌렸고,
  //   덤으로 위 사각지대(정적 import)까지 줄었다.
  // 실측 ④(2026-08-29, 저장소 토큰을 배포 조건부 필수로, 2103 뮤턴트): **73.94%**
  //   죽음 1554 · 타임아웃 1 · 생존 420 · 커버 안 됨 128 · 에러 0
  //   (커버된 것만 보면 78.73%)
  //   테스트 766 → 777. 뮤턴트가 26개 늘고 생존은 그대로다 — 새 분기(`isVercelDeployment`,
  //   `requiredAppEnv`, `recommendedAppEnv`)가 전부 눌렸다는 뜻이다.
  //   `app/api/health/route.ts`는 죽음 46 · 생존 1이고, 그 하나는 아래 동치 뮤턴트다.
  // 실측 ⑤(2026-08-29, 워커 생존 신호, 2190 뮤턴트): **74.93%**
  //   죽음 1640 · 타임아웃 1 · 생존 421 · 커버 안 됨 128 · 에러 0
  //   (커버된 것만 보면 79.58%)
  //   테스트 777 → 806. 뮤턴트가 87개 늘고 그중 86개가 죽었다. 새 파일 둘이
  //   `lib/render-wait-state.ts` **100%**(47/47), `lib/worker-liveness.ts` **97.22%**(35/36)이고
  //   남은 하나는 아래 동치 뮤턴트다. `app/api/jobs/*`의 생존 12건은 전부 이전부터 있던
  //   401/404 본문 문자열과 `dynamic` 리터럴이다 — 새로 늘어난 생존자는 없다.
  //
  // **이 68.49%는 테스트 스위트의 품질이 아니라 하한(floor)이다.** 위 `coverageAnalysis`
  // 주석의 사각지대 때문에 생존 478 중 **51개는 유령**이다(실제로는 죽는다). 래칫 기준으로는
  // 하한이어도 아무 문제가 없다 — 같은 조건에서 잰 값이고, 회귀는 그대로 잡힌다.
  // 다만 **점수를 스위트의 성적표로 인용하지 말 것.**
  //
  // 알려진 **동치 뮤턴트**(죽일 수 없다, 목록에 영원히 남는다):
  //   · `app/api/projects/route.ts`의 첫 401 — `readSessionFromRequest`가 `''`를 반환하지 않고
  //     `getStudent(null)`이 스스로 막으므로, 지워도 바이트 동일한 401이 나온다
  //   · `voiceAnalysis`의 `Math.max(0, ·)` 제거 — density가 음수가 될 수 없다
  //   · `lib/request-body.ts`의 `body === null` 제거와 `catch` 본문 비우기 — 양쪽 다
  //     결과가 그대로 `null`이다(그 파일 주석 참고)
  //   · 모든 라우트의 `export const dynamic = 'force-dynamic'` StringLiteral — 핸들러
  //     동작이 같아 단위 테스트로는 죽일 수 없다(빌드 시점 동작만 바뀐다)
  //   · `lib/worker-liveness.ts`의 `readHeartbeat` catch 본문 비우기 — `null` 대신
  //     `undefined`가 돌아오는데 두 호출자(`current &&`, `!current`)가 똑같이 읽는다
  //   이들을 쫓지 말 것. 죽이려면 프로덕션 코드를 바꿔야 하고 그건 테스트가 아니다.
  //
  // `break`는 그 바로 아래인 **74.9**이다(74.93 − 0.03). 지금 상태는 통과하지만 여유는
  // 사실상 **0개**다 — 1641/2190이 1640/2190(74.89%)이 되는 순간 빨개진다. 그게 래칫의
  // 일이다: 새로 생기는 생존자를 그 자리에서 보여 준다.
  //
  // 느린 기계에서 빨개지지 않는다: 타임아웃은 *검출*로 계산되므로 부하가 걸리면 점수가
  // **올라간다.** 즉 실측치는 한산한 기계에서의 하한이다.
  // 어림수(80 같은)를 쓰지 않는 이유: 실제 점수보다 높으면 첫날부터 빨간 빌드가 되고
  // 그러면 누군가 이 잡을 꺼버린다. 한참 아래면 장식이다.
  //
  // 점수가 떨어져서 빌드가 빨개지면 **임계값을 내리지 말고** 죽지 않은 뮤턴트를 죽이는
  // 테스트를 써라. 점수를 올렸으면 이 값도 새 점수 바로 아래로 함께 올려라 —
  // 그래야 다음 회귀도 잡힌다.
  thresholds: { high: 80, low: 60, break: 74.9 },

  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  timeoutMS: 20000,
};

export default config;
