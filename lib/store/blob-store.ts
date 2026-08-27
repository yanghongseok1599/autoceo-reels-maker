import { get, list, put } from '@vercel/blob';
import { assertSafeStoreKey, STORE_LIST_PAGE_SIZE, type Store } from './types';

/**
 * `put`의 `cacheControlMaxAge` 기본값은 **한 달**이다
 * (`node_modules/@vercel/blob/dist/index.d.ts:462`). 이 저장소의 값은 잡이 진행될 때마다
 * 바뀌므로 한 달짜리 캐시는 곧 "완료된 잡이 계속 queued로 읽히는" 상태가 되고, 그 상태에서
 * 다음 `enqueueJob`이 낡은 배열을 읽어-수정-쓰면 그 사이 만들어진 잡이 전부 사라진다.
 * SDK가 허용하는 최소값(1분)을 쓴다.
 */
export const BLOB_JSON_MAX_AGE_SECONDS = 60;

export const blobStore: Store & { kind: 'blob' } = {
  kind: 'blob',

  async read<T>(key: string, fallback: T): Promise<T> {
    assertSafeStoreKey(key);
    try {
      /**
       * `fetch(url, { cache: 'no-store' })`로는 부족했다 — 그건 Next의 데이터 캐시만 끄고
       * Vercel CDN 캐시는 그대로 탄다. `useCache: false`가 CDN을 건너뛰고 원본 저장소에서
       * 최신 내용을 읽는 옵션이다(`index.d.ts:220`).
       */
      const result = await get(`${key}.json`, { access: 'public', useCache: false });
      if (!result || result.statusCode !== 200) return fallback;
      return (await new Response(result.stream).json()) as T;
    } catch {
      return fallback;
    }
  },

  async write<T>(key: string, value: T): Promise<void> {
    assertSafeStoreKey(key);
    await put(`${key}.json`, JSON.stringify(value, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: BLOB_JSON_MAX_AGE_SECONDS,
    });
  },

  async list(prefix: string): Promise<string[]> {
    assertSafeStoreKey(prefix);
    const keys: string[] = [];
    try {
      /**
       * 커서를 **끝까지** 따라간다. 한 페이지만 읽으면 그 뒤의 키는 존재하지 않는 것과
       * 같아지고, 이 목록의 유일한 용도가 "인덱스에서 사라진 잡 찾기"이므로 그건 곧
       * 조용히 복구를 포기하는 것이다. 잡은 매달 쌓이므로 시간이 지나면 반드시 온다.
       *
       * `limit`도 직접 준다. 주지 않으면 1000이 기본값이라 지금은 같지만, SDK가 기본값을
       * 바꾸면 왕복 횟수가 말없이 달라진다(`index.d.ts:290`).
       */
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, limit: STORE_LIST_PAGE_SIZE, cursor });
        for (const blob of page.blobs) {
          if (blob.pathname.endsWith('.json')) {
            keys.push(blob.pathname.slice(0, -'.json'.length));
          }
        }
        // `hasMore`만 믿고 돌면 커서 없는 응답 하나에 무한 루프가 된다.
        cursor = page.hasMore && page.cursor ? page.cursor : undefined;
      } while (cursor);
    } catch {
      // 읽기와 같은 태도다. 목록을 못 얻는 것은 호출자를 죽이는 대신 거기까지 본 것으로 답한다.
      return keys;
    }
    return keys;
  },
};
