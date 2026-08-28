/**
 * `student-index`를 **`students/`에 실제로 있는 계정에서** 재조정한다.
 *
 *   npm run repair:student-index
 *   BLOB_READ_WRITE_TOKEN=<토큰> npm run repair:student-index   # 배포 저장소
 *
 * ## 왜 따로 있나 — 이전 스크립트로는 대부분을 못 고친다
 *
 * `student-index`는 초대코드 해시에서 계정 id로 가는 **유일한 다리**다. 한 줄을 잃으면
 * 그 수강생의 코드는 그냥 듣지 않는다. 레코드는 `students/<id>`에 멀쩡히 있고, 로그인은
 * 401을 돌려주며, 아무 로그도 인덱스를 가리키지 않는다 — 조용하고 완전한 고장이다.
 *
 * Task 9는 "`scripts/shard-store.ts`를 다시 돌리면 재건된다"고 적었다. **그건 이전 시점에
 * 옛 `students` 배열에 있던 계정에만 참이다.** 그 배열은 이전 이후로 아무도 쓰지 않으므로,
 * 이전 뒤에 발급한 계정은 거기 없고 재실행해도 나타나지 않는다. 앞으로 온보딩할 20명은
 * 전부 그쪽이다 — 즉 적어 둔 안전망이 실제로는 없었다.
 *
 * 그래서 정본에서 읽는다. `store.list('students/')`로 계정을 훑고, 각 레코드의 `codeHash`를
 * 자기 id로 잇는다. 옛 배열이 있든 없든, 언제 발급했든 상관없다.
 *
 * ## 왜 로그인 경로가 아니라 운영자 명령인가
 *
 * 로그인 실패마다 이걸 돌리면 계정 수만큼 읽기가 나가고, 그 경로는 **인증 안 된 요청**이
 * 부른다 — 틀린 코드를 반복해 넣는 것만으로 저장소를 두들길 수 있다. 인덱스 유실은 드물고
 * 사람이 알아채는(그 수강생이 말한다) 고장이므로, 사람이 부르는 자리가 맞다.
 * `lib/auth.ts`의 로그인은 이 스크립트를 알지 못하고, 이 스크립트도 그것을 바꾸지 않는다.
 *
 * ## 수리이지 초기화가 아니다
 *
 * 인덱스에서 **아무것도 지우거나 바꾸지 않는다.** 없는 항목만 덧붙이고, 나머지는 세어서
 * 보고한다. 특히 초대코드 하나를 두 계정이 나눠 가진 경우 여기서 한쪽을 고르지 않는다 —
 * 고르는 순간 다른 한 명이 남의 계정으로 들어가거나 조용히 잠긴다. 그건 운영자가 알아야
 * 할 사실이지 스크립트가 뒤에서 정리할 일이 아니다.
 */
import { selectStore } from '../lib/store';
import { STUDENT_INDEX_KEY, type StudentAccount, type StudentIndexEntry } from '../lib/auth';

/** `lib/auth.ts`의 `studentKey`와 같은 자리. 거기서는 비공개라 여기서 다시 적는다. */
const STUDENTS_PREFIX = 'students';

/** 인덱스에 넣지 못한 이유. 전부 **사람이 판단해야** 하는 것들이다. */
export type UnplaceableReason =
  /** 레코드에 `codeHash`가 없다. 어떤 초대코드로도 이 계정에 닿을 수 없다. */
  | 'no-code-hash'
  /** 두 계정이 같은 초대코드를 주장한다. 어느 쪽을 골라도 나머지 한 명이 다친다. */
  | 'duplicate-hash'
  /** 그 해시를 인덱스가 이미 **다른 계정**으로 보내고 있다. 덮으면 그쪽이 잠긴다. */
  | 'index-points-elsewhere'
  /** 레코드를 읽지 못했다(값이 깨졌거나 저장소가 거절했다). */
  | 'unreadable-record'
  /** 인덱스 항목이 가리키는 `students/<id>`가 없다. 지우지 않고 알리기만 한다. */
  | 'dangling-entry';

export interface Unplaceable {
  reason: UnplaceableReason;
  /** 관련된 수강생 id. `duplicate-hash`·`index-points-elsewhere`는 둘 이상이다. */
  ids: string[];
  /** 관련된 초대코드 해시. `no-code-hash`에는 없다. */
  codeHash?: string;
  /** `unreadable-record`가 받은 오류 문구. */
  detail?: string;
}

export interface RepairReport {
  /** `students/` 아래에서 본 계정 키 수(읽지 못한 것 포함). */
  scanned: number;
  /** 인덱스에 **새로 넣은** 항목. 이것이 실제로 고쳐진 로그인들이다. */
  added: StudentIndexEntry[];
  /** 인덱스가 이미 자기 계정을 정확히 가리키고 있던 항목. 손대지 않았다. */
  matched: StudentIndexEntry[];
  /** 넣지 못한 것. 이유와 함께 이름을 부른다 — 숫자만으로는 무엇을 볼지 알 수 없다. */
  unplaceable: Unplaceable[];
}

export async function repairStudentIndex(): Promise<RepairReport> {
  const store = selectStore();
  const report: RepairReport = { scanned: 0, added: [], matched: [], unplaceable: [] };

  const raw = await store.read<unknown>(STUDENT_INDEX_KEY, []);
  // 모르는 모양이면 멈춘다. 배열이 아닌 것에 덧붙이면 인덱스를 통째로 바꿔 버린다.
  if (!Array.isArray(raw)) {
    throw new Error(
      `\`${STUDENT_INDEX_KEY}\`가 배열이 아닙니다. 손대지 않고 멈춥니다: ${typeof raw}`,
    );
  }
  const existing = raw as StudentIndexEntry[];

  /**
   * `codeHash` → 인덱스가 **지금** 가리키는 id. 같은 해시가 두 번 있으면 앞 것을 담는다 —
   * `verifyInviteCode`의 `.find`가 고르는 것이 앞 항목이라, 여기 담긴 값이 곧 실제로
   * 로그인되는 계정이다. 이 지도의 내용은 무엇도 지우거나 바꾸지 않는다.
   */
  const indexed = new Map<string, string>();
  for (const entry of existing) {
    const codeHash = typeof entry?.codeHash === 'string' ? entry.codeHash : '';
    const id = typeof entry?.id === 'string' ? entry.id : '';
    if (codeHash && id && !indexed.has(codeHash)) indexed.set(codeHash, id);
  }

  /**
   * 정본을 훑는다. 옛 `students` 배열이 아니라 여기를 보는 것이 이 스크립트의 요점이다 —
   * 이전 뒤에 발급된 계정은 옛 배열에 없고, 앞으로 만들 계정은 전부 그쪽이다.
   *
   * 정렬하는 이유는 보고가 실행마다 같은 순서로 나오게 하기 위해서다. `readdir`나 Blob
   * 목록의 순서에 기대면 같은 저장소에서 두 번 돌린 결과를 눈으로 비교할 수 없다.
   */
  const ids = (await store.list(`${STUDENTS_PREFIX}/`))
    .map((key) => key.slice(STUDENTS_PREFIX.length + 1))
    .filter((id) => id !== '')
    .sort();

  /** `codeHash` → 그 해시를 주장하는 계정 id들. 둘 이상이면 사람이 정할 일이다. */
  const claimants = new Map<string, string[]>();
  /** 키가 존재하는 id 전부(읽지 못한 것 포함). 인덱스 항목이 떠 있는지 판단하는 근거다. */
  const present = new Set<string>();

  for (const id of ids) {
    report.scanned += 1;
    present.add(id);

    let student: StudentAccount | null;
    try {
      student = await store.read<StudentAccount | null>(`${STUDENTS_PREFIX}/${id}`, null);
    } catch (error) {
      /**
       * 저장소는 깨진 값을 만나면 던진다(`lib/store/file-store.ts`) — 그게 옳다. 다만
       * 여기서 그대로 죽으면 계정 하나가 나머지 열아홉의 수리를 막는다. 수리 도구는
       * 상태가 나쁠 때 돌리는 것이므로, 못 읽은 것은 이름을 부르고 계속 간다.
       */
      report.unplaceable.push({
        reason: 'unreadable-record',
        ids: [id],
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (!student) continue;

    const codeHash = typeof student.codeHash === 'string' ? student.codeHash : '';
    if (!codeHash) {
      report.unplaceable.push({ reason: 'no-code-hash', ids: [id] });
      continue;
    }
    const claiming = claimants.get(codeHash);
    if (claiming) claiming.push(id);
    else claimants.set(codeHash, [id]);
  }

  const toAdd: StudentIndexEntry[] = [];
  for (const [codeHash, owners] of Array.from(claimants.entries())) {
    if (owners.length > 1) {
      // 초대코드 하나에 계정 둘. 인덱스에 한 줄밖에 못 넣으므로 어느 쪽을 넣어도 다른
      // 한 명은 못 들어오거나 남의 계정에 들어간다. 그건 데이터의 문제이지 인덱스의
      // 문제가 아니다 — 조용히 고르지 않고 둘 다 이름을 부른다.
      report.unplaceable.push({ reason: 'duplicate-hash', ids: owners, codeHash });
      continue;
    }
    const [id] = owners;
    const pointsAt = indexed.get(codeHash);
    if (pointsAt === id) {
      report.matched.push({ codeHash, id });
      continue;
    }
    if (pointsAt !== undefined) {
      // 덮으면 지금 그 코드로 들어오던 사람이 잠긴다. 어느 쪽이 진짜인지는 사람만 안다.
      report.unplaceable.push({ reason: 'index-points-elsewhere', ids: [pointsAt, id], codeHash });
      continue;
    }
    toAdd.push({ codeHash, id });
  }

  /**
   * 가리키는 레코드가 없는 항목. **지우지 않는다** — 이 스크립트가 목록을 다 못 봤을
   * 수도 있고(배포 저장소의 `list`는 실패하면 본 데까지만 돌려준다), 지운 항목은 되돌릴
   * 수 없다. 떠 있는 다리는 그 자체로는 아무도 로그인시키지 않으므로 두어도 해가 없다.
   */
  for (const entry of existing) {
    const id = typeof entry?.id === 'string' ? entry.id : '';
    if (id && present.has(id)) continue;
    report.unplaceable.push({
      reason: 'dangling-entry',
      ids: id ? [id] : [],
      codeHash: typeof entry?.codeHash === 'string' ? entry.codeHash : undefined,
    });
  }

  // 덧붙이기만 한다. 있던 항목은 순서까지 그대로다.
  if (toAdd.length) await store.write(STUDENT_INDEX_KEY, [...existing, ...toAdd]);
  report.added = toAdd;
  return report;
}

const REASON_LABEL: Record<UnplaceableReason, string> = {
  'no-code-hash': '초대코드 해시 없음 — 이 계정은 어떤 코드로도 로그인할 수 없습니다',
  'duplicate-hash': '초대코드 중복 — 두 계정이 같은 코드를 씁니다',
  'index-points-elsewhere': '인덱스가 다른 계정을 가리킴 — 덮으면 그쪽이 잠깁니다',
  'unreadable-record': '레코드를 읽지 못함',
  'dangling-entry': '인덱스 항목이 가리키는 계정 없음 — 지우지 않았습니다',
};

const short = (hash: string) => `${hash.slice(0, 8)}…`;

async function main() {
  const store = selectStore();
  const report = await repairStudentIndex();

  console.log(`저장소: ${store.kind}`);
  console.log(`훑은 계정: ${report.scanned}건 (${STUDENTS_PREFIX}/)`);
  console.log(`새로 넣음: ${report.added.length}건`);
  for (const entry of report.added) console.log(`  ${entry.id} ← ${short(entry.codeHash)}`);
  console.log(`이미 맞음: ${report.matched.length}건`);
  console.log(`못 넣음:   ${report.unplaceable.length}건`);
  for (const item of report.unplaceable) {
    const where = item.codeHash ? ` [${short(item.codeHash)}]` : '';
    console.log(
      `  ${item.ids.join(', ') || '(id 없음)'}${where} — ${REASON_LABEL[item.reason]}` +
        (item.detail ? `: ${item.detail}` : ''),
    );
  }

  console.log(
    `\n인덱스에서 아무것도 지우거나 바꾸지 않았습니다 — 없던 항목만 덧붙였습니다.` +
      `\n못 넣은 계정은 여전히 로그인할 수 없습니다. 위 이유를 사람이 확인해야 합니다.`,
  );
}

// 임포트(테스트)로 불릴 때는 실행하지 않는다.
if (process.argv[1] && process.argv[1].endsWith('repair-student-index.ts')) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
