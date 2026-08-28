# 저장소 키 분할 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 동시에 쓰는 두 요청이 서로의 결과를 지우는 일을 없앤다. 지금은 수강생이 "만들기"를 눌러도 잡이 조용히 사라질 수 있다.

**Architecture:** 지금은 일곱 곳이 전부 `배열 전체 읽기 → 고치기 → 배열 전체 쓰기`다. 두 요청이 겹치면 나중에 쓴 쪽이 앞의 변경을 덮는다. 저장소 키를 쪼개서 **서로 다른 요청이 서로 다른 키를 만지게** 한다. 잡은 잡별 키로, 소유자별 데이터는 소유자별 키로, 프로젝트는 프로젝트 id별 키로 나눈다.

**Tech Stack:** Next.js 16 · TypeScript · Vitest · Vercel Blob(배포) / 파일 저장소(로컬)

**Spec:** 별도 스펙 문서 없음. 근거는 아래 "왜 이렇게 나누는가"에 있다.

## Global Constraints

- 저장소 접근은 항상 `store` 인터페이스를 통한다. 프로덕션 코드는 `fileStore`를 직접 import하지 않는다
- **소유자 경계를 넓히지 않는다.** 이번 변경으로 수강생 A가 B의 것을 볼 수 있게 되는 경로가 생기면 안 된다
- 색 리터럴이 허용되는 파일은 `packages/video/src/types.ts` 하나뿐이다
- 커밋 전 `npx vitest run` · `npx tsc --noEmit` · `npx next build`가 모두 깨끗해야 한다
- 커밋은 각 Task 끝에서 한 번씩 한다
- 한국어 UI 문구를 유지한다
- 세로 해상도 1080×1920, fps 30 고정

---

## 왜 이렇게 나누는가

경합은 **서로 다른 수강생 사이**에서 일어난다. 한 사람이 자기 자신과 경쟁하는 일은 드물다(브라우저 하나, 손 하나). 그래서 키를 소유자로 쪼개면 경합의 대부분이 그냥 사라진다.

가장 위험한 곳은 잡 큐다. `updateJob`이 진행률 보고마다(10 → 30 → 55 → 70 → 100) 배열 전체를 읽고 쓴다. 그 사이 다른 수강생이 `enqueueJob`을 하면 **그 잡이 사라지고, 수강생은 버튼을 눌렀는데 아무 일도 일어나지 않는다.** 렌더 한 건마다 이 창이 다섯 번 열린다.

| 지금 키 | 새 키 | 근거 |
|---|---|---|
| `jobs` | `jobs/<jobId>` + `job-index` | 진행률 갱신이 잡 하나만 만져서 큐 추가와 충돌하지 않는다 |
| `projects` | `projects/<projectId>` | **아무도 목록을 조회하지 않는다.** 소유자별로 쪼갤 이유가 없고, id별이면 인덱스도 필요 없다 |
| `style-sheets` | `style-sheets/<ownerId>` | 소유자당 하나 |
| `fish-voices` | `fish-voices/<ownerId>` | |
| `clipart-library` | `clipart-library/<ownerId>` | |
| `learning-records` | `learning-records/<ownerId>` | `ownerId`가 없어서 **추가해야 한다** — 아래 참고 |
| `students` | **그대로 둔다** | 로그인이 초대코드 해시로 조회하므로 전체 스캔이 필요하다. 쓰기는 렌더당 1회이고, 유실되면 크레딧 1회가 안 깎일 뿐이다 |

### `students`를 그대로 두는 판단

`lib/auth.ts:77`이 초대코드 해시로 수강생을 찾는다. id별로 쪼개면 `해시 → id` 인덱스가 필요하고, 그 인덱스가 새 경합 지점이 된다. 얻는 것보다 잃는 게 크다. 유일한 쓰기는 `app/api/projects/route.ts:47`의 크레딧 차감이고, 두 수강생이 같은 순간 렌더를 시작하면 한쪽 차감이 유실된다 — 손해는 운영자의 크레딧 1회이고 수강생에게 보이는 고장이 아니다.

### 학습 기록에서 발견한 보안 결함

`learning-records`를 쪼개려면 `ownerId`가 필요한데, 지금 `LearningRecord`에는 없다. 확인해 보니 그것만이 아니었다:

- `app/api/learning/insights/route.ts` — **세션 검사가 전혀 없다.** 그리고 `getLearningInsights`가 `bestPrompt`로 `best?.script`, 즉 **다른 수강생이 쓴 대본 본문**을 돌려준다. 로그인하지 않은 사람도 `GET /api/learning/insights?format=format_a`로 읽을 수 있다.
- `app/api/learning/import/route.ts` — 세션 검사가 없다. 아무나 학습 기록을 만들 수 있다.

이 저장소는 같은 유형을 이미 두 번 고쳤다(목소리에 소유자가 없던 것, 캐릭터에 경계가 필요했던 것). 세 번째다. `ownerId` 추가가 분할의 전제이므로 Task 5에서 함께 닫는다.

---

## File Structure

**수정**

| 경로 | 변경 |
|---|---|
| `lib/store/file-store.ts` | 중첩 키(`projects/abc`)를 쓸 수 있게 부모 디렉터리 생성 |
| `lib/store/types.ts` | JSON `Store`에도 키 검증 |
| `lib/jobs.ts` | 잡별 키 + `job-index` 투영 |
| `lib/projects.ts` | 프로젝트 id별 키 |
| `lib/style-sheet.ts` · `lib/fish-voice-store.ts` · `lib/clipart-store.ts` | 소유자별 키 |
| `lib/learning-store.ts` | `ownerId` 추가 + 소유자별 키 |
| `app/api/learning/insights/route.ts` · `import/route.ts` · `feedback/route.ts` | 세션 검사 |
| `app/api/jobs/next/route.ts` | `getProject` 호출 유지(시그니처 불변) |

**신규**

| 경로 | 책임 |
|---|---|
| `scripts/shard-store.ts` | 기존 배열을 새 키로 이전 |

---

## Task 1: 중첩 키를 쓸 수 있게 만든다

이게 없으면 나머지 Task가 전부 실패한다. `fileStore.write`가 데이터 디렉터리만 `mkdir`하고 키의 부모는 만들지 않아서, `projects/abc` 키가 `ENOENT`로 죽는다.

**Files:**
- Modify: `lib/store/file-store.ts`, `lib/store/types.ts`
- Test: `lib/store/__tests__/nested-keys.test.ts`

**Interfaces:**
- Consumes: 기존 `Store` 인터페이스
- Produces:
  - `assertSafeStoreKey(key: string): void` — `lib/store/types.ts`에서 export. 빈 문자열, 앞의 `/`, `..` 구간을 거부
  - `fileStore.write`가 중첩 키를 지원

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/store/__tests__/nested-keys.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileStore } from '../file-store';
import { assertSafeStoreKey } from '../types';

beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'store-nested-'));
});

describe('fileStore with nested keys', () => {
  it('writes and reads a key containing a slash', async () => {
    await fileStore.write('projects/proj_abc', { id: 'proj_abc' });
    expect(await fileStore.read('projects/proj_abc', null)).toEqual({ id: 'proj_abc' });
  });

  it('keeps two keys under the same prefix separate', async () => {
    await fileStore.write('clipart-library/u1', ['a']);
    await fileStore.write('clipart-library/u2', ['b']);
    expect(await fileStore.read('clipart-library/u1', [])).toEqual(['a']);
    expect(await fileStore.read('clipart-library/u2', [])).toEqual(['b']);
  });

  it('returns the fallback for a missing nested key', async () => {
    expect(await fileStore.read('clipart-library/nobody', [])).toEqual([]);
  });

  it('still handles a flat key', async () => {
    await fileStore.write('students', [{ id: 'u1' }]);
    expect(await fileStore.read('students', [])).toEqual([{ id: 'u1' }]);
  });
});

describe('assertSafeStoreKey', () => {
  it('accepts a nested key', () => {
    expect(() => assertSafeStoreKey('clipart-library/u1')).not.toThrow();
  });

  // ownerId는 서명된 세션에서 오지만, 키를 만드는 값이 하나라도 신뢰 밖이면
  // 저장소 바깥으로 나갈 수 있다. 방어를 한 겹 둔다.
  it('rejects a key that escapes the store', () => {
    expect(() => assertSafeStoreKey('clipart-library/../students')).toThrow();
    expect(() => assertSafeStoreKey('/etc/passwd')).toThrow();
    expect(() => assertSafeStoreKey('')).toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/store/__tests__/nested-keys.test.ts
```

기대: FAIL — `assertSafeStoreKey` 없음, 그리고 슬래시 키 쓰기가 `ENOENT`

- [ ] **Step 3: 구현**

`lib/store/types.ts`에 추가한다. 기존 `assertSafeKey`(아티팩트 저장소용)는 그대로 두고 JSON 저장소용을 따로 만든다 — 둘은 다른 인터페이스이고, 하나를 고쳐 다른 쪽을 깨뜨리지 않기 위해서다.

```ts
/**
 * JSON 저장소 키 검증. 키가 이제 `ownerId`·`jobId` 같은 값으로 만들어지므로,
 * 그중 하나라도 신뢰 밖이면 저장소 바깥 파일을 읽고 쓸 수 있다.
 */
export function assertSafeStoreKey(key: string): void {
  if (!key || key.startsWith('/') || key.split('/').includes('..')) {
    throw new Error(`저장소 키가 올바르지 않습니다: ${key}`);
  }
}
```

`lib/store/file-store.ts`의 `write`를 고친다:

```ts
  async write<T>(key: string, value: T): Promise<void> {
    assertSafeStoreKey(key);
    const target = path.join(dataDir(), `${key}.json`);
    // 데이터 디렉터리가 아니라 **키의 부모**를 만든다. `projects/abc` 같은 중첩 키가
    // 없으면 `ENOENT`로 죽는다.
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(value, null, 2), 'utf8');
  },
```

`read`에도 `assertSafeStoreKey(key)`를 넣는다. `blobStore`의 `read`/`write`에도 넣는다 — 두 구현이 같은 규칙을 지켜야 한다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
```

기대: 신규 7개 PASS + 기존 전부 통과

- [ ] **Step 5: 커밋**

```bash
git add lib/store lib/store/__tests__
git commit -m "feat: let store keys nest so different writers touch different files"
```

---

## Task 2: 프로젝트를 프로젝트 id별 키로

가장 단순한 분할이다. **아무도 프로젝트 목록을 조회하지 않으므로** 인덱스가 필요 없다.

**Files:**
- Modify: `lib/projects.ts`
- Test: `lib/__tests__/projects.test.ts` (기존 파일. 없으면 새로 만든다)

**Interfaces:**
- Consumes: `assertSafeStoreKey` (Task 1)
- Produces:
  - `createProject(input: { ownerId: string; script: string; voiceReferenceId: string }): Promise<Project>` — 시그니처 불변
  - `getProject(id: string): Promise<Project | null>` — **시그니처 불변**. `app/api/jobs/next/route.ts:19`가 그대로 쓴다

**두 시그니처 모두 바뀌지 않는다.** 호출부를 건드릴 필요가 없다는 뜻이고, 그게 id별 분할을 고른 이유 중 하나다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/projects.test.ts`에 추가한다:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject, getProject } from '../projects';
import { store } from '../store';

beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'projects-'));
});

const input = (ownerId: string) => ({ ownerId, script: '대본', voiceReferenceId: 'v1' });

describe('project storage', () => {
  it('round-trips a project by id', async () => {
    const created = await createProject(input('u1'));
    expect((await getProject(created.id))?.id).toBe(created.id);
  });

  it('returns null for an unknown id', async () => {
    expect(await getProject('proj_nope')).toBeNull();
  });

  // 이 테스트가 이 Task의 요점이다. 옛 구조에서는 두 번째 쓰기가 첫 번째를 덮었다.
  it('keeps both projects when two are created back to back', async () => {
    const [a, b] = await Promise.all([createProject(input('u1')), createProject(input('u2'))]);
    expect(await getProject(a.id)).not.toBeNull();
    expect(await getProject(b.id)).not.toBeNull();
  });

  it('writes each project to its own key', async () => {
    const created = await createProject(input('u1'));
    expect(await store.read(`projects/${created.id}`, null)).not.toBeNull();
    expect(await store.read('projects', null)).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/projects.test.ts
```

기대: FAIL — `writes each project to its own key`가 실패하고, 동시 생성 테스트도 실패한다

- [ ] **Step 3: 구현**

`lib/projects.ts`:

```ts
/** 프로젝트는 id로만 조회된다(`app/api/jobs/next/route.ts`). 목록 조회가 없으므로 인덱스도 없다. */
const projectKey = (id: string) => `projects/${id}`;

export async function createProject(
  input: { ownerId: string; script: string; voiceReferenceId: string },
): Promise<Project> {
  const project: Project = {
    id: `proj_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
    ownerId: input.ownerId, engine: 'remotion', script: input.script,
    voiceReferenceId: input.voiceReferenceId,
    audioUrl: null, subtitles: null, scenes: null, resultUrl: null,
    createdAt: new Date().toISOString(),
  };
  await store.write(projectKey(project.id), project);
  return project;
}

export async function getProject(id: string): Promise<Project | null> {
  return await store.read<Project | null>(projectKey(id), null);
}
```

`const KEY = 'projects'`는 지운다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

기대: 전부 통과. `lib/store/file-store.ts`의 `resetStoreForTests`가 `projects` 배열을 쓰고 있으면 그것도 고친다 — 이제 그 키는 존재하지 않는다.

- [ ] **Step 5: 커밋**

```bash
git add lib/projects.ts lib/__tests__/projects.test.ts
git commit -m "fix: give each project its own key so two students never overwrite each other"
```

---

## Task 3: 잡을 잡별 키 + 인덱스로

이 Task가 계획의 핵심이다. 진행률 갱신이 큐 추가를 지우는 것을 막는다.

**Files:**
- Modify: `lib/jobs.ts`, `lib/store/file-store.ts` (`resetStoreForTests`)
- Test: `lib/__tests__/jobs.test.ts` (기존 파일)

**Interfaces:**
- Consumes: `assertSafeStoreKey` (Task 1)
- Produces — **네 함수 모두 시그니처 불변**:
  - `enqueueJob(input: { projectId: string; ownerId: string }): Promise<RenderJob>`
  - `claimNextJob(now?: Date): Promise<RenderJob | null>`
  - `updateJob(id, patch): Promise<RenderJob | null>`
  - `getJob(id: string): Promise<RenderJob | null>`
  - `JobIndexEntry { id: string; status: RenderJob['status']; createdAt: string; claimedAt: string | null }`

**구조:**

- `jobs/<jobId>` — 잡 하나의 **정본**
- `job-index` — `JobIndexEntry[]`. `claimNextJob`이 후보를 찾기 위한 **투영**

**핵심 규칙 두 가지:**

1. **진행률만 바뀔 때는 인덱스를 건드리지 않는다.** 인덱스에 있는 필드(`status`, `claimedAt`)가 바뀔 때만 쓴다. 진행률은 렌더 한 건에 다섯 번 이상 보고되지만 상태 전이는 세 번뿐이므로, 인덱스 쓰기가 8회에서 3회로 줄고 **가장 잦은 갱신은 인덱스를 아예 만지지 않는다.**
2. **잡을 먼저 쓰고 인덱스를 나중에 쓴다.** 인덱스는 투영이므로, 어긋나면 잡이 이긴다. `claimNextJob`은 인덱스로 후보를 고른 뒤 **그 잡을 다시 읽어 확인하고** 클레임한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/__tests__/jobs.test.ts`에 추가한다:

```ts
// 이 Task 전체의 이유. 옛 구조에서는 진행률 갱신이 그 사이 들어온 잡을 지웠다.
it('keeps a job enqueued while another job is being updated', async () => {
  const running = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
  const [, fresh] = await Promise.all([
    updateJob(running.id, { progress: 55 }),
    enqueueJob({ projectId: 'p2', ownerId: 'u2' }),
  ]);
  expect(await getJob(fresh.id)).not.toBeNull();
  expect((await getJob(running.id))?.progress).toBe(55);
});

it('does not touch the index for a progress-only update', async () => {
  const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
  const before = await store.read('job-index', []);
  await updateJob(job.id, { progress: 30 });
  expect(await store.read('job-index', [])).toEqual(before);
});

it('updates the index when the status changes', async () => {
  const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
  await updateJob(job.id, { status: 'completed' });
  const index = await store.read<{ id: string; status: string }[]>('job-index', []);
  expect(index.find((e) => e.id === job.id)?.status).toBe('completed');
});

it('writes each job to its own key', async () => {
  const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
  expect(await store.read(`jobs/${job.id}`, null)).not.toBeNull();
  expect(await store.read('jobs', null)).toBeNull();
});

// 인덱스가 낡았어도 잡이 정본이다.
it('does not claim a job the index still calls queued but the job says completed', async () => {
  const job = await enqueueJob({ projectId: 'p1', ownerId: 'u1' });
  await store.write(`jobs/${job.id}`, { ...job, status: 'completed' });
  expect(await claimNextJob()).toBeNull();
});
```

기존 테스트(`claimNextJob`의 순서·스테일 클레임 회수)는 시그니처가 바뀌지 않으므로 그대로 통과해야 한다.

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/jobs.test.ts
```

기대: 신규 5개 FAIL

- [ ] **Step 3: 구현**

`lib/jobs.ts`:

```ts
const INDEX_KEY = 'job-index';
const jobKey = (id: string) => `jobs/${id}`;

export interface JobIndexEntry {
  id: string;
  status: RenderJob['status'];
  createdAt: string;
  claimedAt: string | null;
}

const readIndex = () => store.read<JobIndexEntry[]>(INDEX_KEY, []);
const entryOf = (job: RenderJob): JobIndexEntry => ({
  id: job.id, status: job.status, createdAt: job.createdAt, claimedAt: job.claimedAt,
});

/** 인덱스는 투영이다. 잡이 정본이므로 잡을 먼저 쓰고 인덱스를 나중에 쓴다. */
async function putIndexEntry(job: RenderJob): Promise<void> {
  const index = await readIndex();
  const next = entryOf(job);
  await store.write(INDEX_KEY, index.some((e) => e.id === job.id)
    ? index.map((e) => (e.id === job.id ? next : e))
    : [...index, next]);
}
```

`enqueueJob`: 잡을 `jobs/<id>`에 쓰고 인덱스에 추가한다.

`claimNextJob`: 인덱스에서 `isClaimable`을 통과하는 것들을 `createdAt` 순으로 정렬해 후보를 고른다. **그 잡을 다시 읽어** `isClaimable`을 재확인하고(인덱스가 낡았을 수 있다), 통과하면 `status: 'claimed'`로 잡을 쓴 뒤 인덱스를 갱신한다. 확인에 실패하면 다음 후보로 넘어간다.

`updateJob(id, patch)`:

```ts
export async function updateJob(id, patch): Promise<RenderJob | null> {
  const current = await store.read<RenderJob | null>(jobKey(id), null);
  if (!current) return null;
  const next = { ...current, ...patch };
  await store.write(jobKey(id), next);
  // 인덱스에 있는 필드가 바뀔 때만 인덱스를 쓴다. 진행률은 렌더당 5회 이상 오지만
  // 상태 전이는 3회뿐이라, 가장 잦은 갱신이 큐와 충돌하지 않게 된다.
  if (next.status !== current.status || next.claimedAt !== current.claimedAt) {
    await putIndexEntry(next);
  }
  return next;
}
```

`getJob(id)`: `store.read(jobKey(id), null)`.

`lib/store/file-store.ts`의 `resetStoreForTests`에서 `jobs`·`projects` 배열 쓰기를 `job-index` 비우기로 바꾼다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

기대: 전부 통과. 기존 `claimNextJob` 테스트도 손대지 않고 통과해야 한다 — 통과하지 않으면 시그니처나 순서 규칙이 바뀐 것이니 되돌린다.

- [ ] **Step 5: 커밋**

```bash
git add lib/jobs.ts lib/store/file-store.ts lib/__tests__/jobs.test.ts
git commit -m "fix: stop a progress update from erasing a job someone just queued"
```

---

## Task 4: 소유자별 데이터 세 곳

`style-sheets` · `fish-voices` · `clipart-library`. 모양이 같으므로 한 Task로 묶는다.

**Files:**
- Modify: `lib/style-sheet.ts`, `lib/fish-voice-store.ts`, `lib/clipart-store.ts`
- Test: 각 모듈의 기존 테스트 파일

**Interfaces:**
- Consumes: `assertSafeStoreKey` (Task 1)
- Produces — **모든 시그니처 불변**:
  - `getStyleSheet(ownerId)` / `saveStyleSheet(sheet)`
  - `listFishVoices(ownerId)` / `upsertFishVoice(profile)`
  - `listStudentClipart(ownerId)` / `addStudentClipart(entry)` / `catalogFor(ownerId)`

**키:**
- `style-sheets/<ownerId>` — `StyleSheet` 객체 하나(배열이 아니다. 소유자당 하나뿐이므로)
- `fish-voices/<ownerId>` — `FishVoiceProfile[]`
- `clipart-library/<ownerId>` — `ClipartEntry[]`

`saveStyleSheet(sheet)`와 `upsertFishVoice(profile)`, `addStudentClipart(entry)`는 인자 안에 `ownerId`가 있으므로 키를 만들 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

세 모듈 각각에 같은 모양의 테스트를 넣는다. 클립아트 예:

```ts
// 이 Task의 요점. 옛 구조에서는 한쪽이 다른 쪽을 덮었다.
it('keeps both uploads when two students upload at the same time', async () => {
  await Promise.all([
    addStudentClipart({ id: 'c1', ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' }),
    addStudentClipart({ id: 'c2', ownerId: 'u2', keyword: '슬픔', aliases: [], category: '감정', file: 'clipart/b.png' }),
  ]);
  expect((await listStudentClipart('u1')).map((e) => e.keyword)).toEqual(['기쁨']);
  expect((await listStudentClipart('u2')).map((e) => e.keyword)).toEqual(['슬픔']);
});

it('writes each student to their own key', async () => {
  await addStudentClipart({ id: 'c1', ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
  expect(await store.read('clipart-library/u1', [])).toHaveLength(1);
  expect(await store.read('clipart-library', null)).toBeNull();
});

// 소유권 경계는 이번 변경으로도 그대로여야 한다.
it('still shows a student nothing of another student', async () => {
  await addStudentClipart({ id: 'c1', ownerId: 'u1', keyword: '기쁨', aliases: [], category: '감정', file: 'clipart/a.png' });
  expect(await listStudentClipart('u2')).toEqual([]);
});
```

목소리와 스타일시트에도 같은 세 가지를 쓴다. 스타일시트는 소유자당 하나이므로 첫 테스트는 "두 소유자가 동시에 저장해도 둘 다 남는다"로 쓴다.

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run lib/__tests__/clipart-store.test.ts lib/__tests__/fish-voice-store.test.ts lib/__tests__/style-sheet.test.ts
```

기대: 각 파일에서 신규 테스트 FAIL

- [ ] **Step 3: 구현**

세 모듈 모두 `const KEY = '...'`를 `const keyFor = (ownerId: string) => '.../' + ownerId`로 바꾸고, `readAll()`이 소유자를 받게 한다. 소유자 필터(`entry.ownerId === ownerId`)는 **지우지 않는다** — 키가 이미 나누지만, 필터가 사라지면 나중에 키 구조를 바꿀 때 경계가 조용히 열린다. 방어를 두 겹으로 둔다.

`clipart-store.ts`의 `if (!ownerId) return []` 선가드도 유지한다.

- [ ] **Step 4: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

- [ ] **Step 5: 커밋**

```bash
git add lib/style-sheet.ts lib/fish-voice-store.ts lib/clipart-store.ts lib/__tests__
git commit -m "fix: give each student their own key for sheets, voices, and clipart"
```

---

## Task 5: 학습 기록 — 소유자 추가, 세션 검사, 분할

이 Task는 분할이자 보안 수정이다. 셋을 함께 하는 이유는 `ownerId` 없이는 분할할 수 없고, `ownerId`가 생기면 누출이 닫히기 때문이다.

**Files:**
- Modify: `lib/learning-store.ts`, `app/api/learning/insights/route.ts`, `app/api/learning/import/route.ts`, `app/api/learning/feedback/route.ts`
- Test: `lib/__tests__/learning-insights.test.ts`, `app/api/__tests__/learning-routes.test.ts` (신규)

**Interfaces:**
- Consumes: `readSessionFromRequest` (`lib/auth.ts:57`), `assertSafeStoreKey` (Task 1)
- Produces:
  - `LearningRecord`에 `ownerId: string` 추가
  - `createLearningRecord(input: LearningInput & { ownerId: string })`
  - `updateLearningRecord(ownerId: string, id: string, patch)` — **`ownerId`가 첫 인자로 추가된다**
  - `findLearningRecordByJobId(ownerId: string, jobId: string)` — 같음
  - `getLearningInsights(ownerId: string, format: LearnedFormat)` — 같음

**지금 무엇이 잘못됐는가:**

`app/api/learning/insights/route.ts`에 세션 검사가 없고, `getLearningInsights`가 `bestPrompt`로 `best?.script` — 다른 수강생이 쓴 대본 본문 — 을 돌려준다. 로그인하지 않은 사람이 `GET /api/learning/insights?format=format_a`로 읽을 수 있다. `import` 라우트도 세션 검사가 없어 아무나 기록을 만들 수 있다.

- [ ] **Step 1: 실패하는 테스트 작성**

`app/api/__tests__/learning-routes.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { GET as insightsGet } from '../learning/insights/route';
import { POST as importPost } from '../learning/import/route';
import { signSession } from '@/lib/auth';

beforeEach(() => { process.env.SESSION_SECRET = 'test-secret'; });

const req = (url: string, ownerId?: string, body?: unknown) =>
  new Request(url, {
    method: body ? 'POST' : 'GET',
    headers: ownerId ? { Cookie: `student_session=${signSession(ownerId)}` } : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

describe('learning routes require a session', () => {
  it('rejects insights without a session', async () => {
    expect((await insightsGet(req('http://localhost/api/learning/insights?format=format_a'))).status).toBe(401);
  });

  it('rejects import without a session', async () => {
    const r = await importPost(req('http://localhost/api/learning/import', undefined, { format: 'format_a', script: '대본' }));
    expect(r.status).toBe(401);
  });
});

describe('learning insights are per student', () => {
  // 이 테스트가 결함 그 자체다. 수정 전에는 u2가 u1의 대본을 받았다.
  it('never returns another student script', async () => {
    await importPost(req('http://localhost/api/learning/import', 'u1',
      { format: 'format_a', script: 'u1만 아는 비밀 대본' }));

    const body = await (await insightsGet(req('http://localhost/api/learning/insights?format=format_a', 'u2'))).json();
    expect(JSON.stringify(body)).not.toContain('u1만 아는 비밀 대본');
    expect(body.total).toBe(0);
  });

  it('returns a student their own record', async () => {
    await importPost(req('http://localhost/api/learning/import', 'u1',
      { format: 'format_a', script: '내 대본' }));
    const body = await (await insightsGet(req('http://localhost/api/learning/insights?format=format_a', 'u1'))).json();
    expect(body.total).toBe(1);
  });
});
```

`lib/__tests__/learning-insights.test.ts`의 기존 테스트는 `store.write('learning-records', ...)`로 데이터를 심으므로, 키가 `learning-records/<ownerId>`로 바뀌면서 함께 고쳐야 한다. 기존 문턱 테스트(`RECOMMENDATION_MIN_SAMPLES`, 두 분기)는 **의미가 바뀌면 안 된다** — 소유자별로 세는 것으로 바뀔 뿐이다.

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run app/api/__tests__/learning-routes.test.ts
```

기대: 4개 FAIL — 401이 아니라 200이 오고, `u1만 아는 비밀 대본`이 u2의 응답에 들어 있다

- [ ] **Step 3: 저장소에 소유자 추가**

`LearningRecord`에 `ownerId: string`을 넣고, 키를 `learning-records/<ownerId>`로 바꾼다. 네 함수 모두 `ownerId`를 첫 인자로 받는다. 소유자 필터도 함께 둔다(Task 4와 같은 이유로 두 겹).

- [ ] **Step 4: 세 라우트에 세션 검사**

`app/api/voicebox/clone/route.ts`가 이 저장소의 401 처리 규범이니 먼저 읽고 맞춘다:

```ts
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
```

`insights` · `import` · `feedback` 셋 다에 넣고, 그 `ownerId`를 저장소 호출에 넘긴다. **요청 본문에서 소유자를 받지 않는다** — 세션에서만 온다.

- [ ] **Step 5: 통과 확인**

```bash
npx vitest run
npx tsc --noEmit
npx next build
```

기대: 전부 통과. 문턱 테스트가 깨지면 소유자별 집계로 바뀐 것을 반영해 고치되, **문턱 자체(10건, 두 분기)는 그대로 둔다.**

- [ ] **Step 6: 커밋**

```bash
git add lib/learning-store.ts app/api/learning lib/__tests__ app/api/__tests__
git commit -m "fix: keep one student learning records out of another student insights"
```

---

## Task 6: 기존 데이터 이전

로컬 `.local-data`에 실제 데이터가 있다(프로젝트, 목소리, 학습 기록). 이전 없이 배포하면 전부 빈 것처럼 보인다.

**Files:**
- Create: `scripts/shard-store.ts`
- Modify: `package.json` (스크립트 등록)
- Test: `scripts/__tests__/shard-store.test.ts`

**Interfaces:**
- Consumes: `store` (`lib/store`), Task 2~5의 새 키 규칙
- Produces:
  - `shardStore(): Promise<{ moved: Record<string, number>; skipped: string[] }>` — 옮긴 건수를 키별로 보고

**규칙:**
- 옛 키가 없으면 아무것도 하지 않는다(이미 이전됨). 그 키를 `skipped`에 넣는다
- 옛 키를 **지우지 않는다.** 빈 배열로 덮지도 않는다 — 잘못됐을 때 되돌릴 수 있어야 한다
- `learning-records`에는 `ownerId`가 없다. 옛 기록에 넣을 소유자가 없으므로 **`__legacy__` 소유자로 모은다.** 아무 수강생에게도 보이지 않고, 없어진 것도 아니다. 이걸 조용히 아무에게나 배정하면 방금 고친 누출을 되살린다

- [ ] **Step 1: 실패하는 테스트 작성**

`scripts/__tests__/shard-store.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shardStore } from '../shard-store';
import { store } from '@/lib/store';

beforeEach(() => {
  process.env.STORE_DIR = mkdtempSync(path.join(os.tmpdir(), 'shard-'));
});

describe('shardStore', () => {
  it('moves projects to per-id keys', async () => {
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1' }, { id: 'proj_b', ownerId: 'u2' }]);
    const result = await shardStore();
    expect(result.moved.projects).toBe(2);
    expect(await store.read('projects/proj_a', null)).toMatchObject({ id: 'proj_a' });
  });

  it('groups clipart by owner', async () => {
    await store.write('clipart-library', [
      { id: 'c1', ownerId: 'u1', keyword: '기쁨' },
      { id: 'c2', ownerId: 'u1', keyword: '슬픔' },
      { id: 'c3', ownerId: 'u2', keyword: '분노' },
    ]);
    await shardStore();
    expect(await store.read('clipart-library/u1', [])).toHaveLength(2);
    expect(await store.read('clipart-library/u2', [])).toHaveLength(1);
  });

  it('builds the job index and per-job keys', async () => {
    await store.write('jobs', [{ id: 'job_a', status: 'completed', createdAt: '2026-01-01T00:00:00Z', claimedAt: null }]);
    await shardStore();
    expect(await store.read('jobs/job_a', null)).toMatchObject({ id: 'job_a' });
    expect(await store.read('job-index', [])).toHaveLength(1);
  });

  // 옛 기록에는 소유자가 없다. 아무에게나 주면 방금 닫은 누출이 다시 열린다.
  it('parks ownerless learning records under a legacy owner', async () => {
    await store.write('learning-records', [{ id: 'l1', format: 'format_a' }]);
    await shardStore();
    expect(await store.read('learning-records/__legacy__', [])).toHaveLength(1);
  });

  it('leaves the old keys in place so a bad run can be undone', async () => {
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1' }]);
    await shardStore();
    expect(await store.read('projects', [])).toHaveLength(1);
  });

  it('skips a key that has nothing to move', async () => {
    expect((await shardStore()).skipped).toContain('projects');
  });

  it('is safe to run twice', async () => {
    await store.write('projects', [{ id: 'proj_a', ownerId: 'u1' }]);
    await shardStore();
    await shardStore();
    expect(await store.read('projects/proj_a', null)).toMatchObject({ id: 'proj_a' });
  });
});
```

- [ ] **Step 2: 실패 확인**

```bash
npx vitest run scripts/__tests__/shard-store.test.ts
```

기대: FAIL — 모듈 없음

- [ ] **Step 3: 구현**

`scripts/shard-store.ts`. `store`를 쓰므로 `STORE_DIR`이나 `BLOB_READ_WRITE_TOKEN`에 따라 로컬·배포 양쪽에서 같은 코드가 돈다.

- [ ] **Step 4: `package.json`에 등록**

```json
"migrate:store": "tsx scripts/shard-store.ts"
```

- [ ] **Step 5: 통과 확인 후 실제 데이터에 실행**

```bash
npx vitest run
npx tsc --noEmit
cp -r .local-data /tmp/local-data-backup-$(date +%s)
npm run migrate:store
```

백업을 먼저 뜬다. 출력된 키별 건수가 `.local-data`의 옛 파일 건수와 맞는지 확인하고, 맞지 않으면 **보고하고 멈춘다.**

- [ ] **Step 6: 커밋**

```bash
git add scripts/shard-store.ts scripts/__tests__ package.json
git commit -m "feat: move existing store data onto the new sharded keys"
```

---

## Task 7: 끝까지 실행 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: 앱과 워커 기동**

```bash
npm run dev
```

포트 3000은 다른 프로젝트가 쓰고 있으므로 다른 포트를 쓴다. 워커는 별도 셸에서:

```bash
set -a && . ./.env.local && set +a
WORKER_RUN=1 APP_URL=http://localhost:<port> npx tsx worker/index.ts
```

- [ ] **Step 2: 릴스 한 편을 끝까지 만든다**

`TEST01`로 로그인해 대본을 넣고 완성될 때까지 둔다. MP4를 받아 `ffprobe`로 1080×1920·오디오 존재를 확인한다. **이전 계획들이 만들던 것과 같은 결과가 나와야 한다** — 이번 변경은 저장 위치만 바꾸는 것이므로 출력이 달라지면 그게 결함이다.

- [ ] **Step 3: 동시 요청으로 원래 결함을 재현 시도**

렌더가 진행 중일 때(진행률이 갱신되는 동안) 다른 수강생 세션으로 잡을 하나 더 넣는다. **두 잡이 모두 남아 있어야 한다.**

```bash
ls .local-data/jobs/ && cat .local-data/job-index.json
```

- [ ] **Step 4: 보안 수정 확인**

```bash
curl -s -o /dev/null -w '%{http_code}\n' 'http://localhost:<port>/api/learning/insights?format=format_a'
```

기대: `401`. 200이 나오면 **보고하고 멈춘다** — 수정이 붙지 않은 것이다.

- [ ] **Step 5: 결과 기록**

관찰한 것을 적는다. 잡이 하나라도 사라지거나 401이 아니면 보고하고 멈춘다.
