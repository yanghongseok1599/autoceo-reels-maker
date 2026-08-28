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
  //   app/api/voicebox/generate/route.ts       — 생존 36 중 25가 유령
  //   app/api/voicebox/preview/start/route.ts  — 생존 42 중 26이 유령
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
  //   이 둘을 쫓지 말 것. 죽이려면 프로덕션 코드를 바꿔야 하고 그건 테스트가 아니다.
  //
  // `break`는 그 바로 아래인 **68.2**다. 지금 상태는 통과하고, 여유는 뮤턴트 약 6개뿐이다.
  //
  // 느린 기계에서 빨개지지 않는다: 타임아웃은 *검출*로 계산되므로 부하가 걸리면 점수가
  // **올라간다.** 즉 실측치는 한산한 기계에서의 하한이다.
  // 어림수(80 같은)를 쓰지 않는 이유: 실제 점수보다 높으면 첫날부터 빨간 빌드가 되고
  // 그러면 누군가 이 잡을 꺼버린다. 한참 아래면 장식이다.
  //
  // 점수가 떨어져서 빌드가 빨개지면 **임계값을 내리지 말고** 죽지 않은 뮤턴트를 죽이는
  // 테스트를 써라. 점수를 올렸으면 이 값도 새 점수 바로 아래로 함께 올려라 —
  // 그래야 다음 회귀도 잡힌다.
  thresholds: { high: 80, low: 60, break: 68.2 },

  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  timeoutMS: 20000,
};

export default config;
