import { put, list } from '@vercel/blob';
import type { Store } from './types';

export const blobStore: Store & { kind: 'blob' } = {
  kind: 'blob',

  async read<T>(key: string, fallback: T): Promise<T> {
    try {
      const { blobs } = await list({ prefix: `${key}.json`, limit: 1 });
      if (!blobs.length) return fallback;
      const res = await fetch(blobs[0].url, { cache: 'no-store' });
      if (!res.ok) return fallback;
      return (await res.json()) as T;
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
    });
  },
};
