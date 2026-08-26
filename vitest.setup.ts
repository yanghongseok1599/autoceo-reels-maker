import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach } from 'vitest';

// 배포용 Blob 구현체가 선택되지 않게 한다. `store`는 모듈 로드(import) 시점에 결정되므로
// beforeEach 안에서 지우면 이미 늦다 — 어떤 테스트 파일이든 자신의 최상단 import를
// 평가하는 시점은 그 파일의 beforeEach가 처음 실행되기 전이다(collection이 run보다 먼저).
// 그래서 여기 setup 파일의 최상위(top-level)에서 지운다: Vitest는 isolate 모드에서
// 이 setup 파일을 테스트 파일마다 새로 로드하므로, 각 파일의 import보다 반드시 먼저 실행된다.
delete process.env.BLOB_READ_WRITE_TOKEN;

// 어떤 테스트도 사용자의 실제 .local-data/를 건드리지 않는다.
// 거기엔 학습 기록과 파일럿 산출물이 들어 있다.
beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
});
