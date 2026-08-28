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

  /**
   * 파일 구현과 **같은 구분**을 한다: 아직 없는 키는 조용히 fallback, 그 밖의 실패는 시끄럽게.
   *
   * 예전에는 바깥 `catch` 하나가 전부를 삼켰다. 그래서 blob이 잠깐 5xx를 뱉거나 JSON이
   * 깨져 있어도 부르는 쪽에는 "값이 없다"로 보였고, 수강생에게는 자기 목소리·클립아트가
   * 사라진 것처럼 보였다. 두 구현이 여기서 갈리면 로컬에서는 터지고 배포에서는 조용해지는
   * (또는 그 반대인) 상황이 생기므로, 규칙을 한 줄씩 맞춰 둔다.
   */
  async read<T>(key: string, fallback: T): Promise<T> {
    assertSafeStoreKey(key);
    /**
     * `fetch(url, { cache: 'no-store' })`로는 부족했다 — 그건 Next의 데이터 캐시만 끄고
     * Vercel CDN 캐시는 그대로 탄다. `useCache: false`가 CDN을 건너뛰고 원본 저장소에서
     * 최신 내용을 읽는 옵션이다(`index.d.ts:220`).
     */
    const result = await get(`${key}.json`, { access: 'public', useCache: false });
    // SDK는 404일 때만 `null`을 준다(`dist/index.js`의 `get`). 그 외의 실패는 스스로 던진다.
    // 즉 `null`은 "아직 아무도 쓰지 않았다"이고, 이것만이 fallback을 돌려줄 이유다.
    if (!result) return fallback;
    // `ifNoneMatch`를 주지 않으므로 304는 오지 않는다. 그래도 타입상 `stream`이 `null`일 수
    // 있고, 그 경우는 "비어 있음"이 아니라 "값을 못 받았음"이다.
    if (result.statusCode !== 200) {
      throw new Error(`저장소 값을 읽지 못했습니다: ${key} (statusCode ${result.statusCode})`);
    }
    const text = await new Response(result.stream).text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`저장소 값이 깨져 읽을 수 없습니다: ${key}`);
    }
  },

  /**
   * 파일 구현과 달리 여기엔 임시파일+rename이 필요 없다. `put`은 본문을 **한 번의 PUT
   * 요청**으로 보내고(`dist/chunk-YYMLUMXS.js`의 `createPutMethod`; multipart를 켜지 않으므로
   * 분할 업로드 경로로 가지 않는다), 저장소가 객체를 통째로 갈아끼운다. 그래서 읽는 쪽은
   * 옛 객체이거나 새 객체이지 반쪽짜리를 보지 않는다 — 파일 구현이 `writeFile`로 겪던
   * 찢김이 여기엔 없다.
   *
   * 없는 것은 같다: 동시 쓰기에서 **마지막이 이긴다.** 그건 원자성이 아니라 갱신 유실이고,
   * 키를 나눠서 푸는 별개의 문제다.
   */
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
      /**
       * **읽기와 달리** 여기서는 삼킨다. 읽기는 "값이 없다"를 잘못 말하면 수강생에게
       * 데이터가 사라진 것처럼 보이지만, 목록의 유일한 용도는 "인덱스에서 사라진 잡 찾기"라
       * 못 본 고아는 다음 쓸기가 다시 찾는다. 반면 여기서 던지면 워커 폴링이 통째로 죽는다.
       * 그래서 거기까지 본 것으로 답한다.
       */
      return keys;
    }
    return keys;
  },
};
