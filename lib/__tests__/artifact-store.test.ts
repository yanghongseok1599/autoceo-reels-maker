import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileArtifactStore } from '../store/file-artifact-store';
import { selectArtifactStore } from '../store';
import { assertSafeKey } from '../store/types';

/**
 * Blob 구현은 실제 업로드 없이 확인할 수 없으므로 SDK를 갈아 끼운다. 여기서 보는 것은
 * 하나다 — **`put`에 어떤 contentType이 실려 나가는가.** 그 값이 그대로 응답 헤더가 된다.
 */
const { putMock } = vi.hoisted(() => ({ putMock: vi.fn() }));
vi.mock('@vercel/blob', () => ({ put: putMock }));

let publicDir: string;
let source: string;

beforeEach(() => {
  publicDir = mkdtempSync(path.join(os.tmpdir(), 'reels-public-'));
  process.env.PUBLIC_DIR = publicDir;
  source = path.join(mkdtempSync(path.join(os.tmpdir(), 'reels-render-')), 'job_a.mp4');
  writeFileSync(source, 'FAKE-MP4-BYTES');
});

describe('fileArtifactStore.publish', () => {
  it('returns a url the browser can fetch, not a filesystem path', async () => {
    const url = await fileArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(url).toBe('/renders/job_a.mp4');
    expect(url.startsWith(os.tmpdir())).toBe(false);
  });

  it('copies the file under the app public dir so Next serves it', async () => {
    await fileArtifactStore.publish(source, 'renders/job_a.mp4');
    const served = path.join(publicDir, 'renders', 'job_a.mp4');
    expect(existsSync(served)).toBe(true);
    expect(readFileSync(served, 'utf8')).toBe('FAKE-MP4-BYTES');
  });

  it('creates the renders directory when it does not exist yet', async () => {
    expect(existsSync(path.join(publicDir, 'renders'))).toBe(false);
    await fileArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(existsSync(path.join(publicDir, 'renders'))).toBe(true);
  });

  it('overwrites a re-render of the same job', async () => {
    await fileArtifactStore.publish(source, 'renders/job_a.mp4');
    writeFileSync(source, 'SECOND-TAKE');
    await fileArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(readFileSync(path.join(publicDir, 'renders', 'job_a.mp4'), 'utf8')).toBe('SECOND-TAKE');
  });

  it('rejects a key that would escape the public dir', async () => {
    await expect(fileArtifactStore.publish(source, '../../etc/x.mp4')).rejects.toThrow(/올바르지 않습니다/);
    await expect(fileArtifactStore.publish(source, '/etc/x.mp4')).rejects.toThrow(/올바르지 않습니다/);
  });

  it('fails loudly when the render is missing instead of publishing nothing', async () => {
    await expect(fileArtifactStore.publish(path.join(publicDir, 'nope.mp4'), 'renders/x.mp4'))
      .rejects.toThrow();
  });
});

describe('assertSafeKey', () => {
  it('accepts a plain nested key', () => {
    expect(() => assertSafeKey('renders/job_a.mp4')).not.toThrow();
  });

  it('rejects an empty key', () => {
    expect(() => assertSafeKey('')).toThrow();
  });
});

describe('selectArtifactStore', () => {
  it('uses the file store when no blob token is set', () => {
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(selectArtifactStore().kind).toBe('file');
  });

  it('uses the blob store when a token is present', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_x';
    try {
      expect(selectArtifactStore().kind).toBe('blob');
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });

  it('picks the same backend as the json store — never a split brain', async () => {
    const { selectStore } = await import('../store');
    delete process.env.BLOB_READ_WRITE_TOKEN;
    expect(selectArtifactStore().kind).toBe(selectStore().kind);
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_x';
    try {
      expect(selectArtifactStore().kind).toBe(selectStore().kind);
    } finally {
      delete process.env.BLOB_READ_WRITE_TOKEN;
    }
  });
});


/**
 * PNG를 `video/mp4`로 서빙하면 브라우저도 렌더러도 그림을 못 연다. **로컬에서는 멀쩡해
 * 보인다** — 파일 구현은 `public/`에 복사만 하고 타입은 개발 서버가 확장자로 정하기 때문이다.
 * 그래서 이 검사는 Blob 구현 쪽에 있어야 한다.
 */
describe('blobArtifactStore.publish – contentType', () => {
  beforeEach(() => {
    putMock.mockReset();
    putMock.mockResolvedValue({ url: 'https://blob.example/clipart/abc.png' });
  });

  const optionsOfLastPut = () => putMock.mock.calls[0][2] as { contentType: string };

  it('serves an uploaded image as the image it is', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    const url = await blobArtifactStore.publish(source, 'clipart/abc.png', 'image/png');
    expect(optionsOfLastPut().contentType).toBe('image/png');
    expect(url).toBe('https://blob.example/clipart/abc.png');
  });

  // 저장소는 클립아트 전용이 아니다. 호출자가 준 값을 손대지 않고 그대로 넘기는지 본다.
  it('forwards whatever type the caller names, unchanged', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'generated-audio/ab.mp3', 'audio/mpeg');
    expect(optionsOfLastPut().contentType).toBe('audio/mpeg');
  });

  // 기본값이 있어야 렌더 워커(`worker/index.ts`)의 기존 호출을 건드리지 않는다.
  it('still publishes a render as video/mp4 when the caller says nothing', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(optionsOfLastPut().contentType).toBe('video/mp4');
  });

  it('still refuses a key that escapes the store', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await expect(blobArtifactStore.publish(source, '../x.png', 'image/png'))
      .rejects.toThrow(/올바르지 않습니다/);
    expect(putMock).not.toHaveBeenCalled();
  });
});

/**
 * 로컬 구현은 이 인자를 쓰지 않는다(확장자로 정해진다). 그래도 호출자가 두 구현에 같은
 * 방식으로 넘길 수 있어야 하므로, 넘겼을 때 아무것도 깨지지 않는 것까지 박아 둔다.
 */
describe('fileArtifactStore.publish – contentType', () => {
  it('accepts the argument and behaves exactly as before', async () => {
    expect(await fileArtifactStore.publish(source, 'clipart/abc.png', 'image/png'))
      .toBe('/clipart/abc.png');
    expect(readFileSync(path.join(publicDir, 'clipart', 'abc.png'), 'utf8')).toBe('FAKE-MP4-BYTES');
  });
});

/**
 * `contentType` 말고 **나머지 옵션 전부**를 박는다.
 *
 * 여섯 개 중 어느 하나가 조용히 뒤집혀도 로컬에서는 아무 증상이 없다 — 파일 구현은 이
 * 옵션들을 아예 보지 않기 때문이다. 증상은 전부 배포에서만, 그것도 한참 뒤에 나온다:
 * `addRandomSuffix`가 켜지면 URL이 잡 id와 달라져 재렌더가 옛 파일을 덮지 못하고,
 * `allowOverwrite`가 꺼지면 재렌더가 통째로 실패하며, `multipart`가 꺼지면 수십 MB짜리
 * 업로드가 실패할 때마다 처음부터 다시 올라간다. `access`가 좁아지면 수강생 브라우저가
 * 403을 받고, `cacheControlMaxAge`가 짧아지면 CDN이 매번 오리진을 때린다.
 *
 * 그래서 **넘어가는 옵션 객체의 모양을 통째로** 확인한다. 하나가 바뀌어도, 새 옵션이
 * 슬쩍 끼어들어도 여기서 걸린다.
 */
describe('blobArtifactStore.publish – 업로드 옵션', () => {
  beforeEach(() => {
    putMock.mockReset();
    putMock.mockResolvedValue({ url: 'https://blob.example/renders/job_a.mp4' });
  });

  const lastPut = () => putMock.mock.calls[0];
  const options = () => lastPut()[2] as Record<string, unknown>;

  it('올린 자리를 호출자가 준 key 그대로 쓴다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(lastPut()[0]).toBe('renders/job_a.mp4');
  });

  /** 워커 디스크의 그 파일이 올라가야 한다 — 빈 스트림이나 경로 문자열이 아니라. */
  it('로컬 파일의 바이트를 스트림으로 올린다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    const body = lastPut()[1] as { path?: string | Buffer; readable?: boolean };
    expect(String(body.path)).toBe(source);
  });

  /** 수강생 브라우저가 토큰 없이 `<video src>`로 연다. private면 403이다. */
  it('공개 접근으로 올린다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(options().access).toBe('public');
  });

  /** 주소는 잡 id로 정해진다. 접미사가 붙으면 재렌더가 옛 파일 옆에 새 파일을 만든다. */
  it('임의 접미사를 붙이지 않는다 — 주소는 잡 id가 정한다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(options().addRandomSuffix).toBe(false);
  });

  /** 같은 잡을 다시 렌더하면 같은 key에 다시 쓴다. 막으면 재렌더가 실패한다. */
  it('같은 key 덮어쓰기를 허용한다 — 재렌더가 실패하지 않게', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(options().allowOverwrite).toBe(true);
  });

  /**
   * 1년. 상수를 import해서 비교하면 상수가 바뀔 때 검사도 같이 따라가 아무것도 못 잡는다.
   * 그래서 초 단위 실값을 여기 적어 둔다.
   */
  it('CDN에 1년을 맡긴다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(options().cacheControlMaxAge).toBe(31_536_000);
    expect(options().cacheControlMaxAge).toBe(365 * 24 * 60 * 60);
  });

  /** 1분짜리 릴스는 수십 MB다. 단일 PUT은 실패하면 처음부터 다시 올린다. */
  it('멀티파트로 올린다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(options().multipart).toBe(true);
  });

  /** 옵션이 하나 사라지거나 새로 끼어드는 것까지 걸리게 모양 전체를 본다. */
  it('넘기는 옵션은 정확히 이 여섯 개다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'clipart/abc.png', 'image/png');
    expect(options()).toEqual({
      access: 'public',
      contentType: 'image/png',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31_536_000,
      multipart: true,
    });
  });

  /** 타입을 말하지 않는 호출자(렌더 워커)의 옵션도 나머지가 똑같아야 한다. */
  it('타입을 생략해도 나머지 옵션은 그대로다', async () => {
    const { blobArtifactStore } = await import('../store/blob-artifact-store');
    await blobArtifactStore.publish(source, 'renders/job_a.mp4');
    expect(options()).toEqual({
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: true,
      cacheControlMaxAge: 31_536_000,
      multipart: true,
    });
  });
});
