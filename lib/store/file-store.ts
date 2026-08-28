import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
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

  /**
   * **없는 키**와 **깨진 키**를 구분한다.
   *
   * 예전에는 `catch`가 둘 다 삼키고 fallback을 돌려줬다. 아직 아무도 쓰지 않은 키는 그게
   * 맞다 — 매 요청마다 일어나는 정상이다. 하지만 JSON이 깨진 것까지 같은 대접을 하면
   * 수강생의 목소리 목록이 "목소리가 하나도 없습니다"로 읽힌다. 그 사람에게는 자료가
   * 사라진 것으로 보이고, 고쳐야 할 사람에게는 아무 단서도 남지 않는다.
   * 그래서 **없으면 조용히, 깨졌으면 시끄럽게** 한다.
   */
  async read<T>(key: string, fallback: T): Promise<T> {
    assertSafeStoreKey(key);
    let raw: string;
    try {
      raw = await readFile(path.join(dataDir(), `${key}.json`), 'utf8');
    } catch (error) {
      // `ENOENT`만이 fallback을 돌려줄 이유다. 권한 오류 같은 나머지는 "비어 있음"이 아니라
      // "읽지 못했음"이므로 부르는 쪽이 알아야 한다.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
      throw error;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      throw new Error(`저장소 값이 깨져 읽을 수 없습니다: ${key}`);
    }
  },

  /**
   * 임시파일에 쓴 뒤 **rename으로 갈아끼운다.**
   *
   * 예전에는 대상 파일에 곧장 `writeFile`을 했다. 그건 열면서 파일을 0으로 자르고 나서
   * 내용을 쓰는 것이라, 두 요청이 같은 키를 동시에 쓰면 짧은 쪽이 긴 쪽의 앞부분만 덮고
   * 뒤꼬리가 남는다 — 파일이 `]]`로 끝나는 **깨진 JSON**이 된다. 실제로 수강생 두 명이
   * 같은 순간에 "만들기"를 누르는 것만으로 `students.json`이 그렇게 깨졌고, 그 뒤로는
   * 아무도 로그인할 수 없었다.
   *
   * `rename`은 같은 파일시스템 안에서 원자적이다. 그래서 읽는 쪽은 **옛 파일이거나 새
   * 파일이지, 반쪽짜리는 절대 보지 않는다.** 임시파일을 대상과 같은 디렉터리에 두는 것이
   * 조건이다 — 다른 디렉터리(예: /tmp)에 두면 파일시스템이 달라질 수 있고, 그러면
   * `rename`이 복사로 바뀌어 원자성이 사라진다.
   *
   * 임시파일 이름에 pid와 난수를 붙이는 이유도 같다. 이름이 고정이면 동시 쓰기 두 개가
   * **임시파일에서** 서로를 덮어써서, 방금 없앤 결함을 한 칸 옆으로 옮겨 놓게 된다.
   *
   * 이 원자성은 마지막 쓰기가 이긴다는 뜻이지 잃어버린 갱신이 없다는 뜻은 아니다.
   * 읽어-수정-쓰기가 서로를 덮는 것은 키를 나눠서 푸는 별개의 문제다.
   */
  async write<T>(key: string, value: T): Promise<void> {
    assertSafeStoreKey(key);
    const target = path.join(dataDir(), `${key}.json`);
    // 데이터 디렉터리가 아니라 **키의 부모**를 만든다. `projects/abc` 같은 중첩 키가
    // 없으면 `ENOENT`로 죽는다.
    await mkdir(path.dirname(target), { recursive: true });
    // `.tmp`로 끝나므로 `list`의 `.json` 필터에 걸리지 않는다 — 중간에 죽어 남더라도
    // 키 하나가 더 있는 것처럼 보이지 않는다.
    const temp = `${target}.${process.pid.toString(36)}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
      await rename(temp, target);
    } catch (error) {
      // 실패한 임시파일은 치운다. 치우다 또 실패하는 것은 원래 오류를 가릴 뿐이라 삼킨다.
      await unlink(temp).catch(() => {});
      throw error;
    }
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
