import { fileStore } from './file-store';
import { blobStore } from './blob-store';
import type { Store } from './types';

export function selectStore(): Store & { kind: 'file' | 'blob' } {
  return process.env.BLOB_READ_WRITE_TOKEN ? blobStore : fileStore;
}

export const store = selectStore();
