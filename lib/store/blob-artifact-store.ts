import { createReadStream } from 'node:fs';
import { put } from '@vercel/blob';
import { assertSafeKey, type ArtifactStore } from './types';

/**
 * 완성된 MP4는 잡 id로 주소가 정해지고 다시 쓰이지 않는다 — 같은 URL의 내용이 바뀔 일이
 * 없으므로 CDN에 오래 두는 편이 맞다. 내용이 바뀌는 JSON(`blob-store.ts`)과는 정반대 선택이고,
 * 그쪽은 `BLOB_JSON_MAX_AGE_SECONDS`로 최소값을 쓴다.
 */
export const ARTIFACT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * 호출자가 타입을 말하지 않으면 렌더 산출물로 본다. 이 저장소에 올라가는 것의 대부분이
 * 완성된 MP4이고, 그 호출자들을 고치지 않기 위한 기본값이다.
 */
export const DEFAULT_ARTIFACT_CONTENT_TYPE = 'video/mp4';

export const blobArtifactStore: ArtifactStore & { kind: 'blob' } = {
  kind: 'blob',

  async publish(
    localPath: string,
    key: string,
    contentType: string = DEFAULT_ARTIFACT_CONTENT_TYPE,
  ): Promise<string> {
    assertSafeKey(key);
    const { url } = await put(key, createReadStream(localPath), {
      access: 'public',
      // 여기서 정한 값이 그대로 응답 헤더가 된다. 하드코딩하면 PNG가 `video/mp4`로 서빙된다.
      contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: ARTIFACT_MAX_AGE_SECONDS,
      // 1분짜리 1080x1920 릴스는 수십 MB다. 단일 PUT은 실패하면 처음부터 다시 올려야 한다.
      multipart: true,
    });
    return url;
  },
};
