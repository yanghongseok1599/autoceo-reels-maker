import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedStudent, generateInviteCode, buildStudent } from '../../scripts/seed-student';
import {
  getStudent,
  hashCode,
  verifyInviteCode,
  STUDENT_INDEX_KEY,
  type StudentIndexEntry,
} from '../auth';
import { selectStore } from '../store';

/**
 * 계정은 `students/<id>`에, 코드→id 다리만 `student-index`에 들어간다. 옛 `students` 배열을
 * 읽어 확인하면 이제 없는 키의 fallback `[]`를 받아 **무엇을 썼든 통과하는 빈 검사**가 된다.
 */
const index = () => selectStore().read<StudentIndexEntry[]>(STUDENT_INDEX_KEY, []);

beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'reels-store-'));
});

describe('seedStudent', () => {
  it('writes through the selected store, not a hard-coded file', async () => {
    const seeded = await seedStudent('홍길동', 'ABCD-1234');
    expect((await getStudent(seeded.id))?.name).toBe('홍길동');
    // 옛 공유 배열은 되살아나지 않는다 — 되살아나면 갱신 유실도 함께 돌아온다.
    expect(await selectStore().read('students', null)).toBeNull();
  });

  it('stores only the hash, never the code itself', async () => {
    const seeded = await seedStudent('홍길동', 'ABCD-1234');
    const raw = JSON.stringify([await getStudent(seeded.id), await index()]);
    expect(raw).not.toContain('ABCD-1234');
    expect(raw).toContain(hashCode('ABCD-1234'));
  });

  it('adds one index entry per account so login can find it by code', async () => {
    const first = await seedStudent('첫번째', 'AAAA-1111');
    const second = await seedStudent('두번째', 'BBBB-2222');
    expect(await index()).toEqual([
      { codeHash: hashCode('AAAA-1111'), id: first.id },
      { codeHash: hashCode('BBBB-2222'), id: second.id },
    ]);
  });

  it('produces a student that the login route accepts', async () => {
    await seedStudent('홍길동', 'ABCD-1234');
    expect((await verifyInviteCode('abcd-1234'))?.name).toBe('홍길동');
  });

  it('keeps existing students', async () => {
    await seedStudent('첫번째', 'AAAA-1111');
    await seedStudent('두번째', 'BBBB-2222');
    // 두 번째 발급이 첫 번째를 덮지 않는다 — 둘 다 자기 코드로 여전히 들어온다.
    expect((await verifyInviteCode('AAAA-1111'))?.name).toBe('첫번째');
    expect((await verifyInviteCode('BBBB-2222'))?.name).toBe('두번째');
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
