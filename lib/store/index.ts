import { fileStore } from './file-store';
import { blobStore } from './blob-store';
import { fileArtifactStore } from './file-artifact-store';
import { blobArtifactStore } from './blob-artifact-store';
import type { ArtifactStore, Store } from './types';

export function selectStore(): Store & { kind: 'file' | 'blob' } {
  return process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore;
}

/** JSON 저장소와 같은 기준으로 고른다 — 한쪽만 배포용이 되는 상황을 만들지 않는다. */
export function selectArtifactStore(): ArtifactStore {
  return process.env.BLOB_READ_WRITE_TOKEN ? blobArtifactStore : fileArtifactStore;
}

export const store = selectStore();
