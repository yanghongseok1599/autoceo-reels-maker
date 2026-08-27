import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { appPublicDir } from '../paths';
import { assertSafeKey, type ArtifactStore } from './types';

/**
 * 로컬 개발용. 워커와 Next 앱이 같은 저장소 루트에서 돌기 때문에, `public/` 아래로 복사하면
 * 그대로 `http://localhost:3000/renders/<jobId>.mp4`로 열린다.
 *
 * 배포에서는 쓰이지 않는다 — Vercel은 빌드 시점의 `public/`을 스냅샷으로 서빙하므로 런타임에
 * 생긴 파일은 보이지 않는다. 배포 환경에는 `BLOB_READ_WRITE_TOKEN`이 있고, 그러면
 * `selectArtifactStore()`가 Blob 구현을 고른다.
 */
export const fileArtifactStore: ArtifactStore & { kind: 'file' } = {
  kind: 'file',

  /**
   * `contentType`을 받지 않는다. 여기서는 파일을 `public/` 아래로 복사할 뿐이고 응답 헤더는
   * 개발 서버가 확장자로 정하기 때문이다. 인터페이스에는 선택 인자로 있으므로 호출자는
   * 두 구현에 같은 방식으로 넘길 수 있다 — 다만 그 값이 실제로 쓰이는 곳은 Blob 구현뿐이다
   * (`lib/store/types.ts`의 `publish` 주석).
   */
  async publish(localPath: string, key: string): Promise<string> {
    assertSafeKey(key);
    const dest = path.join(appPublicDir(), key);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(localPath, dest);
    return `/${key}`;
  },
};
