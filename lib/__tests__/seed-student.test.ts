import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedStudent, generateInviteCode, buildStudent } from '../../scripts/seed-student';
import { hashCode, verifyInviteCode, type StudentAccount } from '../auth';
import { selectStore } from '../store';

beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
});

describe('seedStudent', () => {
  it('writes through the selected store, not a hard-coded file', async () => {
    await seedStudent('홍길동', 'ABCD-1234');
    const students = await selectStore().read<StudentAccount[]>('students', []);
    expect(students.map((s) => s.name)).toEqual(['홍길동']);
  });

  it('stores only the hash, never the code itself', async () => {
    await seedStudent('홍길동', 'ABCD-1234');
    const raw = JSON.stringify(await selectStore().read<StudentAccount[]>('students', []));
    expect(raw).not.toContain('ABCD-1234');
    expect(raw).toContain(hashCode('ABCD-1234'));
  });

  it('produces a student that the login route accepts', async () => {
    await seedStudent('홍길동', 'ABCD-1234');
    expect((await verifyInviteCode('abcd-1234'))?.name).toBe('홍길동');
  });

  it('keeps existing students', async () => {
    await seedStudent('첫번째', 'AAAA-1111');
    await seedStudent('두번째', 'BBBB-2222');
    expect((await selectStore().read<StudentAccount[]>('students', [])).length).toBe(2);
  });

  it('refuses to issue the same code twice', async () => {
    await seedStudent('첫번째', 'AAAA-1111');
    await expect(seedStudent('두번째', 'AAAA-1111')).rejects.toThrow(/이미 등록된/);
  });
});

describe('generateInviteCode', () => {
  it('is grouped and excludes look-alike characters', () => {
    const code = generateInviteCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(code).not.toMatch(/[01OI]/);
  });
});

describe('buildStudent', () => {
  it('starts the student at zero renders in the current period', () => {
    const s = buildStudent('홍길동', 'ABCD-1234', new Date('2026-08-26T00:00:00Z'));
    expect(s.monthlyRenderCount).toBe(0);
    expect(s.renderPeriod).toBe('2026-08');
  });
});
