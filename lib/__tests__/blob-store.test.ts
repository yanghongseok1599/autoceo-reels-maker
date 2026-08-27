import { describe, it, expect, vi, beforeEach } from 'vitest';

const put = vi.fn();
const get = vi.fn();
const list = vi.fn();
vi.mock('@vercel/blob', () => ({
  put: (...a: unknown[]) => put(...a),
  get: (...a: unknown[]) => get(...a),
  list: (...a: unknown[]) => list(...a),
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

describe('blobStore.list', () => {
  const blob = (pathname: string) => ({ pathname, url: `https://x/${pathname}`, size: 1 });

  /**
   * 파일 구현은 디렉터리를 읽고 이쪽은 SDK를 부르지만, 부르는 쪽은 **같은 모양의 키**를
   * 받아야 한다. 한쪽만 `.json`을 달고 오면 잡 고아 쓸기가 배포에서만 아무것도 못 찾는다.
   */
  it('returns keys without the storage extension', async () => {
    list.mockResolvedValue({
      blobs: [blob('jobs/job_a.json'), blob('jobs/job_b.json')], hasMore: false,
    });
    expect(await (await blobStore()).list('jobs/')).toEqual(['jobs/job_a', 'jobs/job_b']);
  });

  // 페이지 크기를 직접 준다. SDK 기본값(1000)에 기대면 기본값이 바뀌는 날 왕복 횟수가 말없이 달라진다.
  it('asks for the prefix with an explicit page size instead of trusting the SDK default', async () => {
    const { STORE_LIST_PAGE_SIZE } = await import('../store/types');
    list.mockResolvedValue({ blobs: [], hasMore: false });
    await (await blobStore()).list('jobs/');
    expect(list).toHaveBeenCalledWith({
      prefix: 'jobs/', limit: STORE_LIST_PAGE_SIZE, cursor: undefined,
    });
  });

  /**
   * 한 페이지만 읽으면 그 뒤의 키는 없는 것과 같아진다. 이 목록의 유일한 용도가
   * "인덱스에서 사라진 잡 찾기"이므로, 그건 조용히 복구를 포기하는 것과 같다.
   */
  it('follows the cursor until the listing is exhausted', async () => {
    list
      .mockResolvedValueOnce({ blobs: [blob('jobs/a.json')], hasMore: true, cursor: 'c1' })
      .mockResolvedValueOnce({ blobs: [blob('jobs/b.json')], hasMore: true, cursor: 'c2' })
      .mockResolvedValueOnce({ blobs: [blob('jobs/c.json')], hasMore: false });
    expect(await (await blobStore()).list('jobs/')).toEqual(['jobs/a', 'jobs/b', 'jobs/c']);
    expect(list.mock.calls.map(([o]) => (o as { cursor?: string }).cursor))
      .toEqual([undefined, 'c1', 'c2']);
  });

  // `hasMore`만 믿고 돌면 커서 없는 응답 하나에 워커 폴링이 무한 루프로 멈춘다.
  it('stops instead of looping forever when the store says hasMore with no cursor', async () => {
    list.mockResolvedValue({ blobs: [blob('jobs/a.json')], hasMore: true });
    expect(await (await blobStore()).list('jobs/')).toEqual(['jobs/a']);
    expect(list).toHaveBeenCalledTimes(1);
  });

  // 중간에 끊겨도 거기까지 본 것은 돌려준다 — 이번에 못 본 고아는 다음 쓸기에서 잡힌다.
  it('keeps the pages it already read when a later page fails', async () => {
    list
      .mockResolvedValueOnce({ blobs: [blob('jobs/a.json')], hasMore: true, cursor: 'c1' })
      .mockRejectedValueOnce(new Error('network'));
    expect(await (await blobStore()).list('jobs/')).toEqual(['jobs/a']);
  });

  it('ignores anything that is not a JSON value', async () => {
    list.mockResolvedValue({
      blobs: [blob('jobs/job_a.json'), blob('jobs/leftover.txt')], hasMore: false,
    });
    expect(await (await blobStore()).list('jobs/')).toEqual(['jobs/job_a']);
  });

  // 목록을 못 얻는 것은 "아무것도 없다"로 처리한다. 여기서 던지면 워커 폴링이 통째로 죽는다.
  it('falls back to an empty list instead of throwing when the store errors', async () => {
    list.mockRejectedValue(new Error('network'));
    expect(await (await blobStore()).list('jobs/')).toEqual([]);
  });
});
