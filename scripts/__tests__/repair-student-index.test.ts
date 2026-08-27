import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { repairStudentIndex } from '../repair-student-index';
import { shardStore } from '../shard-store';
import { seedStudent } from '../seed-student';
import { store } from '../../lib/store';
import {
  hashCode,
  verifyInviteCode,
  STUDENT_INDEX_KEY,
  type StudentAccount,
  type StudentIndexEntry,
} from '../../lib/auth';

/**
 * `STORE_DIR`은 `vitest.setup.ts`가 테스트마다 새 임시 디렉터리로 잡아 준다.
 *
 * 단언은 되도록 `verifyInviteCode`로 한다. 인덱스에 줄이 생겼는지가 아니라 **그 수강생이
 * 실제로 들어올 수 있는지**가 이 스크립트가 존재하는 이유이기 때문이다.
 */
const readIndex = () => store.read<StudentIndexEntry[]>(STUDENT_INDEX_KEY, []);

const account = (id: string, code: string, over: Partial<StudentAccount> = {}): StudentAccount => ({
  id,
  name: `수강생-${id}`,
  codeHash: hashCode(code),
  monthlyRenderCount: 0,
  renderPeriod: '2026-08',
  createdAt: '2026-08-26T00:00:00Z',
  ...over,
});

describe('repairStudentIndex — 이전 뒤에 발급된 계정', () => {
  /**
   * Task 9 보고서가 적어 둔 복구 경로("`shard-store.ts`를 다시 돌리면 된다")가 **실제로는
   * 대부분의 경우에 없다**는 것을 그대로 재현한다. 이전 스크립트는 옛 `students` 배열에서
   * 인덱스를 만드는데, 이전 뒤에 발급된 계정은 거기에 없다. 앞으로 온보딩할 20명이 전부
   * 그쪽이므로, 그 계정들에겐 안전망이 아예 없었다.
   */
  it('이전 스크립트 재실행은 이전 뒤에 발급된 계정을 되살리지 못한다', async () => {
    await store.write('students', [account('u1', 'OLDA-1111')]);
    await shardStore();
    const seeded = await seedStudent('새수강생', 'NEWA-2222');

    // 인덱스 한 줄이 사라졌다.
    await store.write(STUDENT_INDEX_KEY, []);
    expect(await verifyInviteCode('NEWA-2222')).toBeNull();

    await shardStore();

    // 이전 시점에 배열에 있던 계정만 돌아온다.
    expect((await verifyInviteCode('OLDA-1111'))?.id).toBe('u1');
    // 레코드는 멀쩡한데 어떤 초대코드로도 닿지 않는다 — 조용하고 완전한 고장.
    expect(await store.read(`students/${seeded.id}`, null)).not.toBeNull();
    expect(await verifyInviteCode('NEWA-2222')).toBeNull();
  });

  it('수리는 이전 뒤에 발급된 계정의 로그인을 되살린다', async () => {
    await store.write('students', [account('u1', 'OLDA-1111')]);
    await shardStore();
    const seeded = await seedStudent('새수강생', 'NEWA-2222');

    await store.write(STUDENT_INDEX_KEY, []);
    expect(await verifyInviteCode('NEWA-2222')).toBeNull();

    const report = await repairStudentIndex();

    expect((await verifyInviteCode('NEWA-2222'))?.id).toBe(seeded.id);
    expect((await verifyInviteCode('OLDA-1111'))?.id).toBe('u1');
    expect(report.scanned).toBe(2);
    expect(report.added.map((e) => e.id).sort()).toEqual([seeded.id, 'u1'].sort());
    expect(report.unplaceable).toEqual([]);
  });

  it('옛 배열이 아예 없어도 정본만으로 재건한다', async () => {
    // 옛 키를 정리한 뒤의 세상. 이전 스크립트에게는 아무 재료도 없다.
    const seeded = await seedStudent('새수강생', 'NEWA-2222');
    await store.write(STUDENT_INDEX_KEY, []);

    await repairStudentIndex();

    expect((await verifyInviteCode('NEWA-2222'))?.id).toBe(seeded.id);
  });
});

describe('repairStudentIndex — 초기화가 아니라 재조정', () => {
  it('이미 맞는 항목은 다시 넣지 않고 세기만 한다', async () => {
    await seedStudent('수강생', 'AAAA-1111');
    const before = await readIndex();

    const report = await repairStudentIndex();

    expect(report.added).toEqual([]);
    expect(report.matched).toHaveLength(1);
    expect(await readIndex()).toEqual(before);
  });

  it('두 번 돌려도 인덱스가 늘지 않는다', async () => {
    await seedStudent('수강생', 'AAAA-1111');
    await store.write(STUDENT_INDEX_KEY, []);

    await repairStudentIndex();
    const afterFirst = await readIndex();
    const second = await repairStudentIndex();

    expect(await readIndex()).toEqual(afterFirst);
    expect(second.added).toEqual([]);
    expect(second.matched).toHaveLength(1);
  });

  it('관계없는 항목을 지우지 않는다', async () => {
    await seedStudent('수강생', 'AAAA-1111');
    const seededEntry = (await readIndex())[0];
    // 계정이 사라진(또는 아직 안 보이는) 항목. 지우면 되돌릴 수 없다.
    await store.write(STUDENT_INDEX_KEY, [{ codeHash: hashCode('GONE-0000'), id: 'u_gone' }]);

    const report = await repairStudentIndex();

    expect(await readIndex()).toEqual([
      { codeHash: hashCode('GONE-0000'), id: 'u_gone' },
      seededEntry,
    ]);
    expect(report.unplaceable).toContainEqual({
      reason: 'dangling-entry',
      ids: ['u_gone'],
      codeHash: hashCode('GONE-0000'),
    });
  });

  it('인덱스가 배열이 아니면 손대지 않고 멈춘다', async () => {
    await store.write('students/u1', account('u1', 'AAAA-1111'));
    await store.write(STUDENT_INDEX_KEY, { 이건: '배열이 아니다' });

    await expect(repairStudentIndex()).rejects.toThrow(/배열이 아닙니다/);
    expect(await store.read(STUDENT_INDEX_KEY, null)).toEqual({ 이건: '배열이 아니다' });
  });
});

describe('repairStudentIndex — 못 넣은 것', () => {
  it('초대코드 해시가 없는 계정은 넣지 않고 이름을 부른다', async () => {
    await store.write('students/u1', account('u1', 'AAAA-1111'));
    await store.write('students/u2', { id: 'u2', name: '해시없음' });

    const report = await repairStudentIndex();

    expect(report.added.map((e) => e.id)).toEqual(['u1']);
    expect(report.unplaceable).toContainEqual({ reason: 'no-code-hash', ids: ['u2'] });
    // 넣을 수 있는 것은 넣는다 — 한 건 때문에 나머지를 포기하지 않는다.
    expect((await verifyInviteCode('AAAA-1111'))?.id).toBe('u1');
  });

  it('같은 초대코드를 주장하는 두 계정 중 하나를 고르지 않는다', async () => {
    await store.write('students/u1', account('u1', 'SAME-9999'));
    await store.write('students/u2', account('u2', 'SAME-9999'));

    const report = await repairStudentIndex();

    expect(report.added).toEqual([]);
    expect(report.unplaceable).toContainEqual({
      reason: 'duplicate-hash',
      ids: ['u1', 'u2'],
      codeHash: hashCode('SAME-9999'),
    });
    // 고르지 않았으므로 아무도 그 코드로 들어오지 못한다. 운영자가 정할 일이다.
    expect(await verifyInviteCode('SAME-9999')).toBeNull();
    expect(await readIndex()).toEqual([]);
  });

  it('인덱스가 다른 계정을 가리키고 있으면 덮지 않는다', async () => {
    await store.write('students/u1', account('u1', 'AAAA-1111'));
    await store.write('students/u9', account('u9', 'ZZZZ-9999'));
    // 인덱스가 u1의 해시를 u9로 보내고 있다. 덮으면 지금 들어오던 사람이 잠긴다.
    await store.write(STUDENT_INDEX_KEY, [{ codeHash: hashCode('AAAA-1111'), id: 'u9' }]);

    const report = await repairStudentIndex();

    expect(report.unplaceable).toContainEqual({
      reason: 'index-points-elsewhere',
      ids: ['u9', 'u1'],
      codeHash: hashCode('AAAA-1111'),
    });
    expect(report.added.map((e) => e.id)).toEqual(['u9']); // u9 자기 코드는 놓아 준다
    expect((await readIndex())[0]).toEqual({ codeHash: hashCode('AAAA-1111'), id: 'u9' });
    // 어긋난 항목으로 남의 계정에 들어가지지도 않는다 — `verifyInviteCode`가 레코드를 재확인한다.
    expect(await verifyInviteCode('AAAA-1111')).toBeNull();
  });

  it('읽지 못하는 레코드 하나가 나머지 수리를 막지 않는다', async () => {
    await store.write('students/u1', account('u1', 'AAAA-1111'));
    await store.write('students/u2', account('u2', 'BBBB-2222'));
    await store.write(STUDENT_INDEX_KEY, []);
    // `store.write`는 직렬화하므로 깨진 파일을 만들 수 없다. 바이트로 직접 심는다.
    const dir = path.join(process.env.STORE_DIR!, 'students');
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'u2.json'), '{"id":"u2",', 'utf8');

    const report = await repairStudentIndex();

    expect((await verifyInviteCode('AAAA-1111'))?.id).toBe('u1');
    expect(report.unplaceable).toHaveLength(1);
    expect(report.unplaceable[0].reason).toBe('unreadable-record');
    expect(report.unplaceable[0].ids).toEqual(['u2']);
  });
});
