import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
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

  async list(prefix: string): Promise<string[]> {
    assertSafeStoreKey(prefix);
    const dir = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
    let names: string[];
    try {
      names = await readdir(path.join(dataDir(), dir));
    } catch {
      // 아직 아무것도 안 쓴 prefix는 오류가 아니라 "비어 있음"이다.
      return [];
    }
    // 자르지 않는다. `readdir`는 이미 전부를 주고, 여기서 상한을 두면 배포 구현이
    // 커서를 따라가며 지우는 바로 그 결함을 파일 쪽에 다시 만드는 꼴이다.
    return names
      .filter((name) => name.endsWith('.json'))
      .map((name) => `${dir}/${name.slice(0, -'.json'.length)}`);
  },
};

/**
 * `projects`도 `jobs`도 더 이상 지울 배열이 아니다 — 둘 다 이제 `projects/<id>`,
 * `jobs/<id>`처럼 자기 키에 하나씩 들어간다. 빈 배열을 다시 써 두면 실제로는 아무도
 * 읽지 않는 키가 남아, 아직 배열인 척하는 것처럼 보인다.
 *
 * 잡에서 남는 배열은 `job-index` 하나뿐이다 — 잡 자체가 아니라 후보를 고르기 위한 투영이다.
 */
export async function resetStoreForTests(): Promise<void> {
  await fileStore.write('job-index', []);
}
