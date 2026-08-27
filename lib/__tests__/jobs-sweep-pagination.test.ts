import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { RenderJob, JobIndexEntry } from '../jobs';

/**
 * 고아 쓸기를 **배포 저장소 구현 위에서** 돌린다.
 *
 * 목록에 페이지가 있는 쪽은 Blob뿐이라, 파일 저장소로는 이 결함을 재현할 수 없다.
 * 한때 `list`는 첫 페이지에서 잘렸다. 수강생 20명이 한 달에 25편씩 만들면 잡 키가
 * 월 500개씩 쌓여 두 달이면 페이지를 넘고, 그 뒤로 첫 페이지 밖의 고아 잡은 영영
 * 복구되지 않는다 — 게다가 그 증상은 쓸기가 고치려던 버그와 구분되지 않는다.
 *
 * 키를 천 개 만들어 확인할 필요는 없다. 실제 서버도 요청한 `limit`보다 적게 줄 수 있으므로,
 * 여기서는 가짜 SDK가 항상 세 개씩 끊어 준다. 검사하는 것은 페이지 크기가 아니라 **커서를
 * 끝까지 따라가는가**이기 때문이다.
 */
const PAGE_SIZE = 3;
const blobs = new Map<string, string>();

vi.mock('@vercel/blob', () => ({
  put: async (pathname: string, body: string) => {
    blobs.set(pathname, body);
    return { url: `https://store.public.blob.vercel-storage.com/${pathname}` };
  },
  get: async (pathname: string) => {
    const body = blobs.get(pathname);
    if (body === undefined) return null;
    return { statusCode: 200, stream: new Response(body).body };
  },
  list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
    const all = Array.from(blobs.keys()).filter((p) => p.startsWith(prefix)).sort();
    const start = cursor ? Number(cursor) : 0;
    const next = start + PAGE_SIZE;
    return {
      blobs: all.slice(start, next).map((pathname) => ({ pathname })),
      hasMore: next < all.length,
      cursor: next < all.length ? String(next) : undefined,
    };
  },
}));

// `store`는 모듈 로드 시점에 정해진다. 토큰을 여기 최상위에서 켜야 배포 구현이 뽑힌다
// — vitest.setup.ts가 이 파일의 import보다 먼저 토큰을 지우기 때문에 순서가 중요하다.
process.env.BLOB_READ_WRITE_TOKEN = 'test-blob-token';

const job = (n: number, over: Partial<RenderJob> = {}): RenderJob => ({
  id: `job_${String(n).padStart(2, '0')}`,
  projectId: `p${n}`, ownerId: 'u1', engine: 'remotion',
  status: 'completed', progress: 100, claimedAt: null,
  resultUrl: '/out.mp4', error: null,
  createdAt: `2026-06-0${n}T00:00:00Z`,
  ...over,
});

const entry = (j: RenderJob): JobIndexEntry => ({
  id: j.id, status: j.status, createdAt: j.createdAt, claimedAt: j.claimedAt,
});

beforeEach(() => {
  blobs.clear();
  vi.resetModules();
});

describe('orphan sweep over a paginated store', () => {
  it('finds an orphan that sits beyond the first page', async () => {
    const { store } = await import('../store');
    expect(store.kind).toBe('blob');
    const { claimNextJob } = await import('../jobs');

    // 이미 끝난 잡 여섯 개는 인덱스에 있다. 후보가 없어야 쓸기까지 내려간다.
    const known = [1, 2, 3, 4, 5, 6].map((n) => job(n));
    for (const j of known) await store.write(`jobs/${j.id}`, j);
    await store.write('job-index', known.map(entry));

    // 인덱스 쓰기를 잃은 enqueue. 정렬하면 맨 뒤라 세 번째 페이지에 있다.
    const orphan = job(7, { status: 'queued', progress: 0, resultUrl: null });
    await store.write(`jobs/${orphan.id}`, orphan);

    expect((await claimNextJob(new Date('2026-06-10T00:00:00Z')))?.id).toBe(orphan.id);
    expect((await store.read<JobIndexEntry[]>('job-index', [])).map((e) => e.id))
      .toContain(orphan.id);
  });

  // 첫 페이지 안의 고아는 잘려도 잡히므로, 위 테스트가 진짜 페이지 넘김을 보는지 못 본다.
  // 이 테스트는 그 대조군이다 — 둘 다 통과해야 쓸기가 페이지와 무관하게 동작한다는 뜻이다.
  it('still finds an orphan that sits on the first page', async () => {
    const { store } = await import('../store');
    const { claimNextJob } = await import('../jobs');

    const orphan = job(1, { status: 'queued', progress: 0, resultUrl: null });
    await store.write(`jobs/${orphan.id}`, orphan);
    await store.write('job-index', []);

    expect((await claimNextJob(new Date('2026-06-10T00:00:00Z')))?.id).toBe(orphan.id);
  });
});
