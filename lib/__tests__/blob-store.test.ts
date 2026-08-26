import { describe, it, expect, vi, beforeEach } from 'vitest';

const put = vi.fn();
const get = vi.fn();
vi.mock('@vercel/blob', () => ({
  put: (...a: unknown[]) => put(...a),
  get: (...a: unknown[]) => get(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue({ url: 'https://store.public.blob.vercel-storage.com/jobs.json' });
});

async function blobStore() {
  return (await import('../store/blob-store')).blobStore;
}

describe('blobStore.write', () => {
  // 기본값은 한 달이다. 완료된 잡이 queued로 계속 읽히고, 다음 enqueue가 낡은 배열을 덮어쓴다.
  it('caps the CDN cache at the SDK minimum instead of the one-month default', async () => {
    const { BLOB_JSON_MAX_AGE_SECONDS } = await import('../store/blob-store');
    await (await blobStore()).write('jobs', [{ id: 'job1' }]);
    expect(BLOB_JSON_MAX_AGE_SECONDS).toBe(60);
    expect(put.mock.calls[0][2]).toMatchObject({
      cacheControlMaxAge: 60,
      allowOverwrite: true,
      addRandomSuffix: false,
      access: 'public',
    });
  });

  it('writes to a stable pathname so reads find it again', async () => {
    await (await blobStore()).write('jobs', []);
    expect(put.mock.calls[0][0]).toBe('jobs.json');
  });
});

describe('blobStore.read', () => {
  function ok(body: unknown) {
    return {
      statusCode: 200 as const,
      stream: new Response(JSON.stringify(body)).body,
      headers: new Headers(),
      blob: {},
    };
  }

  // `fetch(cache:'no-store')`는 Next 데이터 캐시만 끈다. CDN을 건너뛰는 건 useCache:false 뿐이다.
  it('bypasses the CDN cache so a completed job never reads back as queued', async () => {
    get.mockResolvedValue(ok([{ id: 'job1', status: 'completed' }]));
    const value = await (await blobStore()).read<unknown[]>('jobs', []);
    expect(get).toHaveBeenCalledWith('jobs.json', { access: 'public', useCache: false });
    expect(value).toEqual([{ id: 'job1', status: 'completed' }]);
  });

  it('falls back when the blob does not exist yet', async () => {
    get.mockResolvedValue(null);
    expect(await (await blobStore()).read('jobs', ['fallback'])).toEqual(['fallback']);
  });

  it('falls back instead of throwing when the store errors', async () => {
    get.mockRejectedValue(new Error('network'));
    expect(await (await blobStore()).read('jobs', ['fallback'])).toEqual(['fallback']);
  });
});
