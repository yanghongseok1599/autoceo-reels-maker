import { describe, it, expect } from 'vitest';
import { fileStore } from '../file-store';
import { assertSafeStoreKey } from '../types';

// STORE_DIR은 vitest.setup.ts의 최상위 beforeEach가 테스트마다 새 임시 디렉터리로 잡아 준다.
// 여기서 또 잡으면 그 장치를 중복으로 흉내 내는 것이라 두지 않는다.

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
