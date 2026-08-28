import { describe, it, expect } from 'vitest';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileStore } from '../file-store';

const dir = () => process.env.STORE_DIR as string;
const filePath = (key: string) => path.join(dir(), `${key}.json`);

function student(name: string, count: number) {
  return {
    id: 'u1', name, codeHash: 'a'.repeat(64),
    monthlyRenderCount: count, createdAt: '2026-08-20T04:11:02.318Z', renderPeriod: '2026-08',
  };
}

describe('fileStore.write는 원자적으로 갈아끼운다', () => {
  /**
   * 결함의 핵심은 "대상 파일을 열면서 0으로 자른 뒤 내용을 쓴다"였다. 그러면 동시 쓰기에서
   * 짧은 쪽이 긴 쪽의 앞부분만 덮고 뒤꼬리가 남아 JSON이 깨진다.
   *
   * 이 검사는 **결과가 아니라 방법**을 본다: 대상 파일이 제자리에서 다시 쓰였다면 inode가
   * 그대로이고, 임시파일을 rename으로 갈아끼웠다면 inode가 바뀐다. 확률에 기대지 않고
   * 한 번의 쓰기만으로 원자성의 전제를 확인할 수 있다.
   */
  it('replaces the target by rename instead of rewriting it in place', async () => {
    await fileStore.write('students', [student('테스트수강생', 1)]);
    const first = await stat(filePath('students'));

    await fileStore.write('students', [student('테스트수강생', 2)]);
    const second = await stat(filePath('students'));

    expect(second.ino).not.toBe(first.ino);
  });

  /**
   * 그리고 실제로 겪은 증상 그대로: 길이가 다른 쓰기를 동시에 몰아쳐도 파일은 언제나
   * 파싱 가능한 JSON이어야 한다. 고치기 전에는 이 반복에서 파일이 `]]`로 끝나며 깨졌고,
   * 그 뒤로 모든 수강생이 로그인하지 못했다.
   */
  it('never leaves a torn file when concurrent writes have different lengths', async () => {
    for (let round = 1; round <= 60; round++) {
      await Promise.all(
        [1, 2, 3, 4].map((w) =>
          fileStore.write('students', [student('테스트수강생'.repeat(w), round * w)]),
        ),
      );
      const raw = await readFile(filePath('students'), 'utf8');
      // 어느 쓰기가 이겼는지는 상관없다. 깨진 파일이 남지 않는 것만이 여기서 지킬 약속이다.
      expect(() => JSON.parse(raw)).not.toThrow();
    }
  });

  /** 임시파일이 남아 키 하나가 더 있는 것처럼 보이면 안 된다. */
  it('leaves no temporary file behind and keeps them out of list()', async () => {
    await fileStore.write('jobs/job_a', { id: 'job_a' });
    expect(await readdir(path.join(dir(), 'jobs'))).toEqual(['job_a.json']);
    expect(await fileStore.list('jobs/')).toEqual(['jobs/job_a']);
  });
});

describe('fileStore.read는 없는 것과 깨진 것을 구분한다', () => {
  // 아직 아무도 쓰지 않은 키는 오류가 아니다. 매 요청마다 일어나는 정상이다.
  it('still returns the fallback for a key nobody has written', async () => {
    expect(await fileStore.read('students', ['fallback'])).toEqual(['fallback']);
    expect(await fileStore.read('fish-voices/u1', [])).toEqual([]);
  });

  /**
   * 깨진 JSON을 삼키면 데이터 유실이 "비어 있음"과 구별되지 않는다. 수강생에게는 목소리가
   * 사라진 것으로 보이고, 고쳐야 할 사람에게는 아무 단서도 남지 않는다.
   */
  it('throws on malformed JSON instead of pretending the key is empty', async () => {
    await writeFile(filePath('students'), '[{"id":"u1"}\n]]', 'utf8');
    await expect(fileStore.read('students', [])).rejects.toThrow(
      '저장소 값이 깨져 읽을 수 없습니다: students',
    );
  });

  /**
   * 실제로 터진 모양 그대로: `students.json`이 찢어졌는데 `[]`로 읽히면 로그인이 401이 되고
   * **아무도** 들어올 수 없게 된다. 그 상태가 조용히 지나가지 않는지 확인한다.
   */
  it('does not let a corrupt students file read back as "no students"', async () => {
    await writeFile(filePath('students'), '[{"id":"u1","name":"테스트수강생"}\n]]', 'utf8');
    await expect(fileStore.read('students', [])).rejects.toThrow();
  });

  // 읽지 못한 것은 비어 있는 것이 아니다 — 디렉터리를 값으로 읽으려는 경우가 그렇다.
  it('surfaces a read failure that is not a missing key', async () => {
    await mkdir(path.join(dir(), 'style-sheets.json'), { recursive: true });
    await expect(fileStore.read('style-sheets', null)).rejects.toThrow();
  });
});
