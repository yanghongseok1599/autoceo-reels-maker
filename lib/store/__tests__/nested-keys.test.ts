import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fileStore } from '../file-store';
import { assertSafeStoreKey } from '../types';

// STORE_DIR은 vitest.setup.ts의 최상위 beforeEach가 테스트마다 새 임시 디렉터리로 잡아 준다.
// 여기서 또 잡으면 그 장치를 중복으로 흉내 내는 것이라 두지 않는다.

// blobStore는 네트워크를 타므로 SDK를 갈아 끼운다. 가드가 **호출 전에** 막는지 보려면
// get/put이 아예 불리지 않았음을 확인해야 한다 — 그래야 "네트워크가 마침 실패했다"가 아니라
// "가드가 돌았다"를 증명한다.
const put = vi.fn();
const get = vi.fn();
vi.mock('@vercel/blob', () => ({
  put: (...a: unknown[]) => put(...a),
  get: (...a: unknown[]) => get(...a),
}));

async function blobStore() {
  return (await import('../blob-store')).blobStore;
}

beforeEach(() => {
  vi.clearAllMocks();
  put.mockResolvedValue({ url: 'https://store.public.blob.vercel-storage.com/x.json' });
  get.mockResolvedValue({ statusCode: 200, stream: new Response('{}').body });
});

describe('fileStore with nested keys', () => {
  it('writes and reads a key containing a slash', async () => {
    await fileStore.write('projects/proj_abc', { id: 'proj_abc' });
    expect(await fileStore.read('projects/proj_abc', null)).toEqual({ id: 'proj_abc' });
  });

  it('keeps two keys under the same prefix separate', async () => {
    await fileStore.write('clipart-library/u1', ['a']);
    await fileStore.write('clipart-library/u2', ['b']);
    expect(await fileStore.read('clipart-library/u1', [])).toEqual(['a']);
    expect(await fileStore.read('clipart-library/u2', [])).toEqual(['b']);
  });

  it('returns the fallback for a missing nested key', async () => {
    expect(await fileStore.read('clipart-library/nobody', [])).toEqual([]);
  });

  it('still handles a flat key', async () => {
    await fileStore.write('students', [{ id: 'u1' }]);
    expect(await fileStore.read('students', [])).toEqual([{ id: 'u1' }]);
  });
});

describe('assertSafeStoreKey', () => {
  it('accepts a nested key', () => {
    expect(() => assertSafeStoreKey('clipart-library/u1')).not.toThrow();
  });

  // ownerId는 서명된 세션에서 오지만, 키를 만드는 값이 하나라도 신뢰 밖이면
  // 저장소 바깥으로 나갈 수 있다. 방어를 한 겹 둔다.
  it('rejects a key that escapes the store', () => {
    expect(() => assertSafeStoreKey('clipart-library/../students')).toThrow();
    expect(() => assertSafeStoreKey('/etc/passwd')).toThrow();
    expect(() => assertSafeStoreKey('')).toThrow();
  });
});

// 함수만 단위 테스트하면 "가드가 붙어 있다"는 검증이 안 된다. 네 호출 지점 중 하나에서
// 가드가 사라져도 CI가 조용하면, 두 구현이 갈라지는 이 프로젝트의 사고가 그대로 반복된다.
// 그래서 저장소 표면으로 나쁜 키를 실제로 흘려보낸다.
describe('저장소 표면이 탈출 키를 거부한다', () => {
  const escaping = ['clipart-library/../students', '/etc/passwd', ''];

  it('fileStore.write refuses every escaping key', async () => {
    for (const key of escaping) {
      await expect(fileStore.write(key, ['x'])).rejects.toThrow('저장소 키가 올바르지 않습니다');
    }
  });

  // read는 없는 값을 fallback으로 삼키는 자리다. 잘못된 키까지 삼키면 경로 탈출 시도가
  // 조용히 지나가므로, 여기서는 fallback이 아니라 throw여야 한다.
  it('fileStore.read refuses every escaping key instead of returning the fallback', async () => {
    for (const key of escaping) {
      await expect(fileStore.read(key, [])).rejects.toThrow('저장소 키가 올바르지 않습니다');
    }
  });

  it('blobStore.write refuses every escaping key before calling the SDK', async () => {
    const store = await blobStore();
    for (const key of escaping) {
      await expect(store.write(key, ['x'])).rejects.toThrow('저장소 키가 올바르지 않습니다');
    }
    expect(put).not.toHaveBeenCalled();
  });

  it('blobStore.read refuses every escaping key before calling the SDK', async () => {
    const store = await blobStore();
    for (const key of escaping) {
      await expect(store.read(key, [])).rejects.toThrow('저장소 키가 올바르지 않습니다');
    }
    expect(get).not.toHaveBeenCalled();
  });

  it('both implementations still accept a nested key', async () => {
    const store = await blobStore();
    await expect(fileStore.write('clipart-library/u1', ['a'])).resolves.toBeUndefined();
    await expect(store.write('clipart-library/u1', ['a'])).resolves.toBeUndefined();
    expect(put).toHaveBeenCalledTimes(1);
  });
});
