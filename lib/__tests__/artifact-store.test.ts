import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileArtifactStore } from '../store/file-artifact-store';
import { selectArtifactStore } from '../store';
import { assertSafeKey } from '../store/types';

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
