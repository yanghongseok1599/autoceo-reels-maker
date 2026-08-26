import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject, getProject } from '../projects';
import { resetStoreForTests } from '../store/file-store';

beforeEach(async () => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
  await resetStoreForTests();
});

describe('createProject', () => {
  it('stores the script and returns an id', async () => {
    const p = await createProject({ ownerId: 'u1', script: '무릎 통증 팁', voiceReferenceId: 'v1' });
    expect(p.script).toBe('무릎 통증 팁');
    expect((await getProject(p.id))?.ownerId).toBe('u1');
  });

  // 워커는 프로젝트에서만 목소리를 읽는다. 여기서 사라지면 렌더가 목소리를 잃는다.
  it('carries the voice the student chose', async () => {
    const p = await createProject({ ownerId: 'u1', script: '대본', voiceReferenceId: 'voice_u1' });
    expect(p.voiceReferenceId).toBe('voice_u1');
    expect((await getProject(p.id))?.voiceReferenceId).toBe('voice_u1');
  });

  it('starts with no result', async () => {
    expect((await createProject({ ownerId: 'u1', script: '대본', voiceReferenceId: 'v1' })).resultUrl)
      .toBeNull();
  });

  it('returns null for an unknown id', async () => {
    expect(await getProject('nope')).toBeNull();
  });
});
