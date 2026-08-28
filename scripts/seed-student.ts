/**
 * 수강생 초대코드를 발급한다.
 *
 *   npx tsx scripts/seed-student.ts "홍길동"              # 코드 자동 생성
 *   npx tsx scripts/seed-student.ts "홍길동" ABCD-1234    # 코드 직접 지정
 *
 * 배포 환경에서는 `BLOB_READ_WRITE_TOKEN`을 함께 넘긴다:
 *
 *   BLOB_READ_WRITE_TOKEN=<토큰> npx tsx scripts/seed-student.ts "홍길동"
 *
 * `.local-data/students/`를 직접 편집하면 로컬에서만 통한다 — 배포는 Blob 저장소를
 * 고르기 때문에 그렇게 만든 코드는 전부 거부된다. 그래서 이 스크립트는 파일이 아니라
 * **선택된 저장소**(`selectStore()`)에 쓴다.
 */
import { randomBytes } from 'node:crypto';
import {
  hashCode,
  inviteCodeTaken,
  registerStudent,
  type StudentAccount,
} from '../lib/auth';
import { selectStore } from '../lib/store';
import { currentPeriod } from '../lib/projects';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 사람이 받아적을 때 헷갈리는 0/O/1/I 제외

export function generateInviteCode(bytes: Buffer = randomBytes(8)): string {
  const chars = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}`;
}

export function buildStudent(name: string, code: string, now: Date = new Date()): StudentAccount {
  return {
    id: `stu_${randomBytes(8).toString('hex')}`,
    name,
    codeHash: hashCode(code),
    monthlyRenderCount: 0,
    renderPeriod: currentPeriod(now),
    createdAt: now.toISOString(),
  };
}

/**
 * 계정은 자기 키(`students/<id>`)에 쓰고, 초대코드 해시는 `student-index`에 덧붙인다
 * (`lib/auth.ts`의 `registerStudent`).
 *
 * 예전에는 `students` 배열 전체를 다시 썼다. 그래서 렌더 요청이 그 배열을 읽어 둔 사이에
 * 발급하면, 렌더의 쓰기가 **방금 발급한 계정을 지웠다** — 이 스크립트는 이미 성공과
 * 초대코드를 출력한 뒤라 운영자도 수강생도 아무 신호를 받지 못했다.
 */
export async function seedStudent(name: string, code: string): Promise<StudentAccount> {
  const student = buildStudent(name, code);

  if (await inviteCodeTaken(student.codeHash)) {
    throw new Error('이미 등록된 초대코드입니다. 다른 코드를 쓰거나 코드를 비워 자동 생성하세요.');
  }

  await registerStudent(student);
  return student;
}

async function main() {
  const [name, given] = process.argv.slice(2);
  if (!name?.trim()) {
    console.error('사용법: npx tsx scripts/seed-student.ts "<이름>" [초대코드]');
    process.exit(1);
  }

  const code = given?.trim() || generateInviteCode();
  const store = selectStore();
  const student = await seedStudent(name.trim(), code);

  console.log(`저장소: ${store.kind}`);
  console.log(`이름:   ${student.name}`);
  console.log(`id:     ${student.id}`);
  console.log(`초대코드: ${code}`);
  console.log('\n이 코드를 수강생에게 전달하세요. 코드 원문은 저장되지 않습니다(해시만 보관).');
}

// 임포트(테스트)로 불릴 때는 실행하지 않는다.
if (process.argv[1] && process.argv[1].endsWith('seed-student.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
