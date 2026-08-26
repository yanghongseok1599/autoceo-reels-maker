import { get, put } from '@vercel/blob';
import type { Store } from './types';

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
    await put(`${key}.json`, JSON.stringify(value, null, 2), {
      access: 'public',
      contentType: 'application/json',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: BLOB_JSON_MAX_AGE_SECONDS,
    });
  },
};
