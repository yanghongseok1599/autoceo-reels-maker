import { describe, it, expect } from 'vitest';
import {
  createLearningRecord,
  findLearningRecordByJobId,
  getLearningInsights,
  updateLearningRecord,
  RECOMMENDATION_MIN_SAMPLES,
  type LearningInput,
  type LearningRecord,
} from '../learning-store';
import { store } from '../store';

/**
 * 기록은 이제 소유자별 키(`learning-records/<ownerId>`)에 들어간다. 예전처럼 공유 배열
 * 하나(`learning-records`)에 심어 두면 이 파일의 검사는 **없는 키의 fallback**을 읽어,
 * 무엇을 심었든 늘 빈 기록을 보게 된다 — 문턱 검사가 통과만 하는 빈 검사로 조용히 바뀐다.
 * 그래서 저장소 모양을 여기서 다시 적지 않고 실제 저장 경로로 심는다.
 */
async function seed(
  ownerId: string,
  n: number,
  good: number,
  overrides: Partial<LearningInput> = {},
) {
  for (let i = 0; i < n; i += 1) {
    const record = await createLearningRecord({
      ownerId, jobId: `j${i}`, format: 'format_a', script: '대본', ...overrides,
    });
    await updateLearningRecord(ownerId, record.id, {
      status: 'completed',
      ...(i < good ? { feedback: 'good' as const } : {}),
    });
  }
}

/** 저장소에 직접 심을 때 쓰는 모양. 경계 검사에서만 쓴다 — 아래 주석 참고. */
const raw = (ownerId: string, script: string, jobId = 'j-raw'): LearningRecord => ({
  id: `l-${ownerId || 'blank'}`, ownerId, jobId, format: 'format_a',
  createdAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z',
  status: 'completed', script, referenceCount: 0, referenceNames: [],
});

describe('getLearningInsights', () => {
  it('withholds a recommendation below the sample threshold', async () => {
    await seed('u1', 3, 1);
    const insights = await getLearningInsights('u1', 'format_a');
    expect(insights.recommendation).toContain('표본');
  });

  it('still reports observed signals below the threshold', async () => {
    await seed('u1', 3, 1);
    const insights = await getLearningInsights('u1', 'format_a');
    expect(insights.signals.length).toBeGreaterThan(0);
    expect(insights.total).toBe(3);
  });

  it('gives a recommendation once the threshold is met', async () => {
    await seed('u1', RECOMMENDATION_MIN_SAMPLES, RECOMMENDATION_MIN_SAMPLES);
    const insights = await getLearningInsights('u1', 'format_a');
    expect(insights.recommendation).not.toContain('표본');
  });

  it('counts rated records, not merely stored ones', async () => {
    await seed('u1', RECOMMENDATION_MIN_SAMPLES, 1);
    const insights = await getLearningInsights('u1', 'format_a');
    expect(insights.recommendation).toContain('표본');
  });

  /**
   * 문턱은 이제 **그 수강생의** 평가를 센다. 예전에는 모두의 평가를 합쳐 셌으므로, 자기
   * 기록이 한 건뿐인 수강생도 남들이 쌓아 둔 수 덕분에 처방을 받았다 — 자기 것과 아무
   * 관계 없는 근거로 내려진 처방이다. 문턱 자체(10건)는 그대로다.
   */
  it('counts only the caller ratings toward the threshold', async () => {
    await seed('u2', RECOMMENDATION_MIN_SAMPLES, RECOMMENDATION_MIN_SAMPLES);
    await seed('u1', 1, 1);
    expect((await getLearningInsights('u1', 'format_a')).recommendation).toContain('표본');
  });

  // format_d는 별도 분기에서 자기 recommendation을 반환한다. 한쪽만 고치면 D탭이 n=1로 처방한다.
  it('applies the threshold to the format_d branch too', async () => {
    await seed('u1', 1, 1, { format: 'format_d' });
    const insights = await getLearningInsights('u1', 'format_d');
    expect(insights.recommendation).toContain('표본');
  });

  it('gives a format_d recommendation once the threshold is met', async () => {
    await seed('u1', RECOMMENDATION_MIN_SAMPLES, RECOMMENDATION_MIN_SAMPLES, {
      format: 'format_d', referenceNames: ['a', 'b'],
    });
    const insights = await getLearningInsights('u1', 'format_d');
    expect(insights.recommendation).not.toContain('표본');
  });

  it('applies the per-caller threshold to the format_d branch as well', async () => {
    await seed('u2', RECOMMENDATION_MIN_SAMPLES, RECOMMENDATION_MIN_SAMPLES, { format: 'format_d' });
    await seed('u1', 1, 1, { format: 'format_d' });
    expect((await getLearningInsights('u1', 'format_d')).recommendation).toContain('표본');
  });
});

/**
 * 예전에는 이 모듈이 `.local-data`에 직접 파일을 읽고 썼다. Vercel에서는 그 경로가
 * 읽기 전용이라 기록이 조용히 사라진다 — `fish-voices`가 겪었던 것과 같은 고장이다.
 * `store` 인터페이스를 타야 배포 저장소로 갈아끼울 수 있고, 테스트가 데이터를 심을 수 있다.
 *
 * 저장소는 `vitest.setup.ts`가 테스트마다 새 `STORE_DIR`을 주므로 따로 비울 것이 없다.
 */
describe('storage backend', () => {
  it('reads what the store holds under the owner key', async () => {
    await store.write('learning-records/u1', [raw('u1', '대본')]);
    expect((await getLearningInsights('u1', 'format_a')).total).toBe(1);
  });

  it('records written by createLearningRecord come back through the store', async () => {
    await createLearningRecord({ ownerId: 'u1', jobId: 'j-new', format: 'format_a', script: '새 대본' });
    const held = await store.read<unknown[]>('learning-records/u1', []);
    expect(held).toHaveLength(1);
    expect((await getLearningInsights('u1', 'format_a')).total).toBe(1);
  });
});

/**
 * 경계는 두 겹이다: 소유자별 키와, 그 뒤에 남는 `ownerId` 필터·빈 소유자 선가드.
 * 아래 검사는 각 겹을 **따로** 누른다 — 한 겹을 지워도 아무것도 실패하지 않으면 그 겹은
 * 언젠가 지워지고, 여기서 열리는 경계는 남이 쓴 대본 본문이다.
 */
describe('학습 기록 소유권 – 경계', () => {
  // 1겹: 키가 나뉜다.
  it("never counts another student's records", async () => {
    await seed('u2', 3, 3);
    await seed('u1', 1, 0);
    const insights = await getLearningInsights('u1', 'format_a');
    expect(insights.total).toBe(1);
    expect(insights.good).toBe(0);
  });

  it("never returns another student's script as the best prompt", async () => {
    await seed('u2', 1, 1, { script: 'u2만 아는 비밀 대본' });
    const insights = await getLearningInsights('u1', 'format_a');
    expect(JSON.stringify(insights)).not.toContain('u2만 아는 비밀 대본');
  });

  /**
   * 2겹: `ownerId` 필터. 키가 이미 나누므로 이 상황은 지금 일어나지 않는다 — 그래서
   * 여기서 직접 만든다. 남의 기록이 이 키에 섞여 든 미래(키 구조 변경, 잘못된 이관)에도
   * 보이지 않아야 한다.
   */
  it("hides a foreign record that ended up under the caller's key", async () => {
    await store.write('learning-records/u1', [raw('u2', 'u2만 아는 비밀 대본')]);
    const insights = await getLearningInsights('u1', 'format_a');
    expect(insights.total).toBe(0);
    expect(insights.bestPrompt).toBe('');
  });

  /**
   * 선가드: 빈 소유자는 전부가 아니라 아무것도. `learning-records/`는 아무의 것도 아닌
   * 자리이고, 거기 무엇이 있든 누군가의 기록으로 다뤄지면 안 된다.
   */
  it('returns nothing for a blank owner rather than whatever sits at the ownerless key', async () => {
    await store.write('learning-records/', [raw('', '주인 없는 대본')]);
    const insights = await getLearningInsights('', 'format_a');
    expect(insights.total).toBe(0);
    expect(insights.bestPrompt).toBe('');
  });

  it("never lets one student patch another student's record", async () => {
    const mine = await createLearningRecord({
      ownerId: 'u1', jobId: 'j1', format: 'format_a', script: '내 대본',
    });

    expect(await updateLearningRecord('u2', mine.id, { feedback: 'bad' })).toBeNull();
    expect((await getLearningInsights('u1', 'format_a')).bad).toBe(0);
  });

  // 갱신도 같은 2겹이다. 남의 기록이 이 키에 섞여 들어도 손대지 못한다.
  it("never patches a foreign record that ended up under the caller's key", async () => {
    await store.write('learning-records/u1', [raw('u2', 'u2만 아는 비밀 대본')]);
    expect(await updateLearningRecord('u1', 'l-u2', { feedback: 'good' })).toBeNull();
  });

  it('patches nothing for a blank owner', async () => {
    await store.write('learning-records/', [raw('', '주인 없는 대본')]);
    expect(await updateLearningRecord('', 'l-blank', { feedback: 'bad' })).toBeNull();
  });

  it("never finds another student's record by jobId", async () => {
    await createLearningRecord({
      ownerId: 'u1', jobId: 'shared-job', format: 'format_a', script: '내 대본',
    });

    expect(await findLearningRecordByJobId('u2', 'shared-job')).toBeNull();
    expect((await findLearningRecordByJobId('u1', 'shared-job'))?.script).toBe('내 대본');
  });

  it('finds nothing for a blank owner', async () => {
    await store.write('learning-records/', [raw('', '주인 없는 대본', 'shared-job')]);
    expect(await findLearningRecordByJobId('', 'shared-job')).toBeNull();
  });

  /**
   * 300건 상한이 사람마다 걸린다. 예전에는 전체 배열 하나에 걸려 있어서, 활발한 수강생
   * 한 명이 다른 사람들의 기록을 상한 밖으로 밀어냈다.
   */
  it("keeps a quiet student's record even while another student is busy", async () => {
    await seed('u1', 1, 0, { script: '조용한 수강생의 대본' });
    await seed('u2', 5, 0);
    expect((await getLearningInsights('u1', 'format_a')).bestPrompt).toBe('조용한 수강생의 대본');
  });
});

/**
 * 위의 소유권 검사들은 남의 소유자(u2)가 기록을 **하나도 갖지 않은** 상태로 묻는다.
 * 빈 목록은 "id가 틀렸다"와 "주인이 틀렸다"를 구별하지 못한다 — 어느 쪽이 막았는지
 * 모른 채 통과하므로, id 검사를 통째로 지워도 아무것도 실패하지 않는다.
 * 그래서 여기서는 **부르는 쪽이 자기 기록을 가진 채로** 엉뚱한 id·jobId를 댄다.
 */
describe('학습 기록 – 자기 기록을 가진 채 엉뚱한 id를 댈 때', () => {
  const held = (ownerId: string) => store.read<LearningRecord[]>(`learning-records/${ownerId}`, []);

  it("patches nothing when the id belongs to another student's record", async () => {
    await createLearningRecord({
      ownerId: 'u1', jobId: 'j-mine', format: 'format_a', script: '내 대본',
    });
    const theirs = await createLearningRecord({
      ownerId: 'u2', jobId: 'j-theirs', format: 'format_a', script: '남의 대본',
    });

    expect(await updateLearningRecord('u1', theirs.id, { feedback: 'bad' })).toBeNull();
    // id 검사가 없으면 u1의 **자기** 기록이 대신 맞았다고 판정돼 조용히 고쳐진다.
    expect((await held('u1')).map((record) => record.feedback)).toEqual([undefined]);
    expect((await getLearningInsights('u1', 'format_a')).bad).toBe(0);
  });

  it('patches nothing for an id that exists nowhere', async () => {
    await createLearningRecord({
      ownerId: 'u1', jobId: 'j-mine', format: 'format_a', script: '내 대본',
    });

    expect(await updateLearningRecord('u1', 'learn_nosuchrecord', { feedback: 'good' })).toBeNull();
    expect((await held('u1')).map((record) => record.feedback)).toEqual([undefined]);
  });

  it('patches the record the id names, not merely the first one the caller owns', async () => {
    const first = await createLearningRecord({
      ownerId: 'u1', jobId: 'j-first', format: 'format_a', script: '첫 대본',
    });
    const second = await createLearningRecord({
      ownerId: 'u1', jobId: 'j-second', format: 'format_a', script: '둘째 대본',
    });

    expect((await updateLearningRecord('u1', first.id, { feedback: 'good' }))?.id).toBe(first.id);
    const records = await held('u1');
    expect(records.find((record) => record.id === first.id)?.feedback).toBe('good');
    expect(records.find((record) => record.id === second.id)?.feedback).toBeUndefined();
  });

  it('finds nothing for a jobId the caller does not have, though they do have records', async () => {
    await createLearningRecord({
      ownerId: 'u1', jobId: 'j-mine', format: 'format_a', script: '내 대본',
    });

    expect(await findLearningRecordByJobId('u1', 'j-someone-else')).toBeNull();
  });

  it('finds the record the jobId names, not merely the first one the caller owns', async () => {
    await createLearningRecord({
      ownerId: 'u1', jobId: 'j-first', format: 'format_a', script: '첫 대본',
    });
    await createLearningRecord({
      ownerId: 'u1', jobId: 'j-second', format: 'format_a', script: '둘째 대본',
    });

    expect((await findLearningRecordByJobId('u1', 'j-first'))?.script).toBe('첫 대본');
    expect((await findLearningRecordByJobId('u1', 'j-second'))?.script).toBe('둘째 대본');
  });
});
