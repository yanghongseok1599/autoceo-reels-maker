import { get, list, put } from '@vercel/blob';
import { assertSafeStoreKey, STORE_LIST_LIMIT, type Store } from './types';

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
    try {
      /**
       * `limit`을 직접 준다. 주지 않으면 1000이 기본값이라 지금은 같지만, SDK가 기본값을
       * 바꾸면 파일 구현과 조용히 갈라진다(`index.d.ts:290`).
       */
      const result = await list({ prefix, limit: STORE_LIST_LIMIT });
      return result.blobs
        .map((blob) => blob.pathname)
        .filter((pathname) => pathname.endsWith('.json'))
        .map((pathname) => pathname.slice(0, -'.json'.length));
    } catch {
      // 읽기와 같은 태도다. 목록을 못 얻는 것은 "아무것도 없다"로 처리하고 호출자를 죽이지 않는다.
      return [];
    }
  },
};
