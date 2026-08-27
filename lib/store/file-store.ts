import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSafeStoreKey, type Store } from './types';

/**
 * 호출 시점에 경로를 정한다. 모듈 로드 시점에 고정하면 테스트가 `STORE_DIR`로 임시 디렉터리를
 * 가리킬 수 없고, 그러면 테스트가 사용자의 실제 `.local-data/`에 쓰게 된다.
 */
function dataDir(): string {
  return process.env.STORE_DIR ?? path.join(process.cwd(), '.local-data');
}

export const fileStore: Store & { kind: 'file' } = {
  kind: 'file' as const,

  async read<T>(key: string, fallback: T): Promise<T> {
    assertSafeStoreKey(key);
    try {
      return JSON.parse(await readFile(path.join(dataDir(), `${key}.json`), 'utf8')) as T;
    } catch {
      return fallback;
    }
  },
  async write<T>(key: string, value: T): Promise<void> {
    assertSafeStoreKey(key);
    const target = path.join(dataDir(), `${key}.json`);
    // 데이터 디렉터리가 아니라 **키의 부모**를 만든다. `projects/abc` 같은 중첩 키가
    // 없으면 `ENOENT`로 죽는다.
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value, null, 2), 'utf8');
  },
};

/**
 * `projects`는 더 이상 지울 배열이 아니다 — 프로젝트는 이제 `projects/<id>`처럼
 * 자기 키에 하나씩 들어간다. 빈 배열을 다시 써 두면 실제로는 아무도 읽지 않는 키가
 * 남아, 아직 배열인 척하는 것처럼 보인다.
 */
export async function resetStoreForTests(): Promise<void> {
  await fileStore.write('jobs', []);
}
