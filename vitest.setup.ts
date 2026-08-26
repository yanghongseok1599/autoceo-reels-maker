import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach } from 'vitest';

// 어떤 테스트도 사용자의 실제 .local-data/를 건드리지 않는다.
// 거기엔 학습 기록과 파일럿 산출물이 들어 있다.
beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
});
