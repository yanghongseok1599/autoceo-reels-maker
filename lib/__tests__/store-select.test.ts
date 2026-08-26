import { describe, it, expect, beforeEach } from 'vitest';
import { selectStore } from '../store';

beforeEach(() => {
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe('selectStore', () => {
  it('uses the file store when no blob token is set', () => {
    expect(selectStore().kind).toBe('file');
  });

  it('uses the blob store when a token is present', () => {
    process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_x';
    expect(selectStore().kind).toBe('blob');
  });
});
