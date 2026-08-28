import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 뮤테이션 실행 전용 Vitest 설정.
//
// 기본 설정(`vitest.config.ts`)과 같되 **딱 하나**를 뺀다:
// `missingCharacterRender.test.ts`. 그 파일은 Remotion을 번들하고 실제 프레임을
// 렌더한다 — 실측 31초로, 전체 스위트 34초 중 31초가 그 파일 몫이다. 나머지는 3초다.
// 뮤테이션은 뮤턴트마다 스위트를 다시 돌리므로 그 파일이 들어가면 실행이 불가능해진다.
//
// 그 테스트는 **약화하거나 지우지 않는다.** 일반 테스트 잡(`npx vitest run`)에는
// 그대로 남아 있고, 거기서 렌더가 깨지는 것을 잡는다. 여기서만 빠진다.
//
// setupFiles는 반드시 그대로 유지한다. `vitest.setup.ts`가 테스트마다 임시
// STORE_DIR을 주고 BLOB_READ_WRITE_TOKEN을 지운다 — 사용자의 실제 `.local-data/`를
// 건드리지 않게 막는 유일한 장치다.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['**/__tests__/**/*.test.ts?(x)'],
    exclude: [
      ...configDefaults.exclude,
      'packages/video/src/__tests__/missingCharacterRender.test.ts',
    ],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
});
