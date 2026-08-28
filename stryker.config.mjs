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
  // 실측(2026-08-28, 1996 뮤턴트): **62.73%**
  //   죽음 1251 · 타임아웃 1 · 생존 499 · 커버 안 됨 245 · 에러 0
  //   (커버된 것만 보면 71.50%)
  //
  // `break`는 그 바로 아래인 **62.5**다. 지금 상태는 통과하고, 여유는 뮤턴트 약 4개뿐이다.
  //
  // 느린 기계에서 빨개지지 않는다: 타임아웃은 *검출*로 계산되므로 부하가 걸리면 점수가
  // **올라간다.** 실측 재실행(기계가 다른 작업으로 바쁠 때) = 63.33%, 타임아웃 1 → 42.
  // 즉 62.73%는 한산한 기계에서의 하한이다.
  // 어림수(80 같은)를 쓰지 않는 이유: 실제 점수보다 높으면 첫날부터 빨간 빌드가 되고
  // 그러면 누군가 이 잡을 꺼버린다. 한참 아래면 장식이다.
  //
  // 점수가 떨어져서 빌드가 빨개지면 **임계값을 내리지 말고** 죽지 않은 뮤턴트를 죽이는
  // 테스트를 써라. 점수를 올렸으면 이 값도 새 점수 바로 아래로 함께 올려라 —
  // 그래야 다음 회귀도 잡힌다.
  thresholds: { high: 80, low: 60, break: 62.5 },

  tempDirName: '.stryker-tmp',
  cleanTempDir: true,
  timeoutMS: 20000,
};

export default config;
