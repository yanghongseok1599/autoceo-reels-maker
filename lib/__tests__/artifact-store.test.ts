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
