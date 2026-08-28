import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { store } from './store';

export interface StudentAccount {
  id: string; name: string; codeHash: string; monthlyRenderCount: number; createdAt: string;
  /** `monthlyRenderCount`가 속한 달(`YYYY-MM`). 없으면 이번 달로 본다 — `lib/projects.ts` 참고. */
  renderPeriod?: string;
}

export const SESSION_COOKIE = 'student_session';

export function hashCode(code: string): string {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex');
}

/**
 * 세션 쿠키에 학생 id를 그냥 담으면 인증이 아니라 자기신고가 된다 —
 * 누구든 `student_session=u1`을 보내면 그 학생이 된다. httpOnly는 JS 읽기만 막을 뿐
 * curl이나 devtools로 값을 넣는 걸 막지 못한다. 그래서 서명한다.
 */
function sessionSecret(): string {
  return process.env.SESSION_SECRET ?? '';
}

export function signSession(studentId: string): string {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error('SESSION_SECRET이 설정되지 않았습니다. 세션에 서명할 수 없습니다.');
  }
  const mac = createHmac('sha256', secret).update(studentId).digest('hex');
  return `${studentId}.${mac}`;
}

/** 서명이 맞을 때만 학생 id를 돌려준다. 비밀값이 없으면 아무도 통과시키지 않는다. */
export function readSession(value: string | undefined | null): string | null {
  const secret = sessionSecret();
  if (!value || !secret) return null;

  const cut = value.lastIndexOf('.');
  if (cut <= 0 || cut === value.length - 1) return null;

  const id = value.slice(0, cut);
  const given = Buffer.from(value.slice(cut + 1), 'utf8');
  const expected = Buffer.from(
    createHmac('sha256', secret).update(id).digest('hex'),
    'utf8',
  );

  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? id : null;
}

/**
 * `next/headers`의 `cookies()`는 요청 스코프 밖에서 던지므로 라우트 핸들러 단위 테스트에서
 * 쓸 수 없다. 요청 헤더를 직접 읽으면 실제 동작은 같고 테스트가 가능해진다.
 */
export function readSessionFromRequest(request: Request): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const cut = part.indexOf('=');
    if (cut < 0) continue;
    if (part.slice(0, cut).trim() !== SESSION_COOKIE) continue;
    const raw = part.slice(cut + 1).trim();
    // 잘못 인코딩된 값(`%zz`)에 decodeURIComponent가 던진다 — 그건 500이 아니라 거절이어야 한다.
    try {
      return readSession(decodeURIComponent(raw));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * 계정 하나에 키 하나. 예전에는 모두가 `students` 배열 하나에 있었고, 릴스 한 편의
 * 생성 횟수 차감이 그 배열 **전체**를 읽어-고쳐-다시 쓰는 일이었다. 렌더 요청이 배열을
 * 읽고 나서 다시 쓰기까지의 100ms 남짓한 창 안에 운영자가 초대코드를 발급하면, 그 쓰기가
 * 방금 만들어진 계정을 지웠다 — 초대코드는 영영 듣지 않고 아무도 신호를 받지 못한다.
 * 원자적 쓰기(`lib/store/file-store.ts`)는 파일이 찢어지는 것을 막을 뿐, 온전한 옛 배열로
 * 덮는 **갱신 유실**은 막지 못한다. 키를 나누는 것만이 겹칠 자리를 없앤다.
 */
const studentKey = (id: string) => `students/${id}`;

/**
 * 초대코드 해시 → 수강생 id. 로그인은 코드 원문밖에 모르므로 `students/<id>`로 바로 갈 수
 * 없고, 그 다리가 이 인덱스다.
 *
 * 이것도 공유 배열이지만 **쓰이는 때가 다르다.** 여기에 쓰는 것은 계정을 만들 때뿐이고
 * (`registerStudent`), 그건 운영자가 손으로 하는 드문 일이라 렌더의 쓰기와 겹치지 않는다.
 * 렌더는 `students/<id>` 하나만 건드리고 이 키는 읽지도 쓰지도 않는다 — 계정을 지울 수 있던
 * 쓰기가 사라진 자리가 여기다.
 */
export const STUDENT_INDEX_KEY = 'student-index';

/** 인덱스 항목. 계정 자체가 아니라 **찾아가는 방법**만 담는다. */
export interface StudentIndexEntry {
  codeHash: string;
  id: string;
}

async function readStudentIndex(): Promise<StudentIndexEntry[]> {
  const entries = await store.read<StudentIndexEntry[]>(STUDENT_INDEX_KEY, []);
  return Array.isArray(entries) ? entries : [];
}

/** 빈 id는 저장소를 읽지 않는다. 그대로 두면 `students/.json`이 키가 된다. */
export async function getStudent(id: string): Promise<StudentAccount | null> {
  if (!id) return null;
  return await store.read<StudentAccount | null>(studentKey(id), null);
}

/**
 * 계정 레코드 하나만 쓴다. 인덱스는 건드리지 않는다 — 생성 횟수 차감처럼 자주 일어나는
 * 쓰기가 공유 키를 만지는 순간 방금 없앤 갱신 유실이 돌아온다.
 */
export async function saveStudent(student: StudentAccount): Promise<void> {
  if (!student.id) throw new Error('수강생 id가 없어 저장할 수 없습니다.');
  await store.write(studentKey(student.id), student);
}

/**
 * 새 계정을 만든다. **인덱스에 쓰는 유일한 곳이다.**
 *
 * 레코드를 먼저 쓰고 인덱스를 나중에 쓴다. 인덱스 쓰기가 실패하면 아무도 못 찾는 레코드가
 * 남을 뿐이지만(운영자가 다시 발급하면 된다), 순서가 반대면 인덱스가 없는 계정을 가리켜
 * 그 초대코드가 영영 죽은 채로 예약된다.
 */
export async function registerStudent(student: StudentAccount): Promise<void> {
  await saveStudent(student);
  const index = await readStudentIndex();
  await store.write(STUDENT_INDEX_KEY, [
    ...index,
    { codeHash: student.codeHash, id: student.id },
  ]);
}

/** 그 초대코드가 이미 발급됐는지. 발급 스크립트가 중복을 거절하는 근거다. */
export async function inviteCodeTaken(codeHash: string): Promise<boolean> {
  return (await readStudentIndex()).some((entry) => entry.codeHash === codeHash);
}

export async function verifyInviteCode(code: string): Promise<StudentAccount | null> {
  if (!code?.trim()) return null;
  const target = hashCode(code);
  const entry = (await readStudentIndex()).find((e) => e.codeHash === target);
  if (!entry) return null;
  const student = await getStudent(entry.id);
  /**
   * 레코드의 해시를 **다시** 본다. 인덱스는 투영이고 정본은 레코드다 — 인덱스가 어긋나면
   * (이전 스크립트의 버그, 손으로 고친 파일) 엉뚱한 계정으로 로그인시킬 수 있다.
   * 비교는 옛 코드와 같은 전체 해시 `===`다. 짧게 줄이거나 접두사만 보지 않는다.
   */
  return student && student.codeHash === target ? student : null;
}
