import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Store } from './types';

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
    try {
      return JSON.parse(await readFile(path.join(dataDir(), `${key}.json`), 'utf8')) as T;
    } catch {
      return fallback;
    }
  },
  async write<T>(key: string, value: T): Promise<void> {
    await mkdir(dataDir(), { recursive: true });
    await writeFile(path.join(dataDir(), `${key}.json`), JSON.stringify(value, null, 2), 'utf8');
  },
};

export async function resetStoreForTests(): Promise<void> {
  await fileStore.write('jobs', []);
  await fileStore.write('projects', []);
}
