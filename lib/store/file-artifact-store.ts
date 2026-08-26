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

  async publish(localPath: string, key: string): Promise<string> {
    assertSafeKey(key);
    const dest = path.join(appPublicDir(), key);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(localPath, dest);
    return `/${key}`;
  },
};
