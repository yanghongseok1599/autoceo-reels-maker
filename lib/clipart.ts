import { createHash } from 'node:crypto';

/**
 * 수강생이 올린 캐릭터 그림은 **그 사람의 것**이다. 소유자 없이 저장하면 모든 수강생의
 * 목록에 남의 캐릭터가 뜨고, 그 id로 남의 얼굴이 박힌 릴스가 만들어진다. `ownerId`는
 * 편의 필드가 아니라 경계다 — 목소리(`lib/fish-voice-store.ts`)와 같은 경계다.
 *
 * 운영자 프리셋은 주인이 따로 없으므로 `ownerId`에 `'__preset__'`을 쓴다(Task 2). 프리셋은
 * 수강생이 자기 것을 하나도 안 올렸을 때만 대신 나오는 자리이지, 남의 것을 보는 게 아니다.
 */
export interface ClipartEntry {
  id: string;
  ownerId: string;
  keyword: string;
  aliases: string[];
  category: string;
  /**
   * `file`이 어디를 가리키는지 가른다. 렌더 단계가 이 값으로 원본 위치를 정하므로
   * 둘을 섞으면 그림이 조용히 사라진다:
   * - `preset`: 운영자 프리셋 디렉터리(`presetDir()`) 기준 상대 경로. `public/` **밖**이라
   *   렌더 전에 public 아래로 복사해 줘야 한다.
   * - `student`: `ArtifactStore.publish`가 돌려준 값. 이미 도달 가능하므로 복사하지 않는다.
   */
  source: 'preset' | 'student';
  file: string;
}

/**
 * 대본 한 토막에 어울리는 캐릭터를 고른다.
 *
 * 캐릭터가 없어도 릴스는 나와야 한다. 매칭 실패는 오류가 아니라 "이 씬엔 캐릭터 없음"이다.
 *
 * 긴 일치를 우선하는 이유: 짧은 낱말이 다른 낱말 안에 우연히 들어가는 일이 잦다. 한국어는
 * 조사·어미가 붙어 늘어나기 때문에(`걱정` → `걱정합니다`) 낱말 경계를 요구할 수가 없고,
 * 그래서 부분 일치가 유일한 방법이면서 동시에 오검출의 원천이다. 같은 자리에 두 낱말이
 * 걸리면 더 긴 쪽이 우연일 확률이 낮다.
 *
 * 다만 긴 일치도 만능은 아니다. 경쟁할 더 긴 term이 카탈로그에 없으면 흔한 낱말의 조각인
 * 키워드는 그대로 걸린다 — 실제 프리셋의 `비`는 `준비 자세`에, `소식`(뉴스)은 식단 대본의
 * `소식하는 습관`에 걸린다(`lib/__tests__/clipart.test.ts`에 기록해 뒀다). 이건 여기서
 * 막을 수 없다. 낱말 경계를 요구하는 순간 `걱정합니다`도 같이 놓치기 때문이다. 방어는
 * 카탈로그 쪽이다: 한두 자짜리 키워드를 넣지 않는다.
 *
 * 길이가 같으면 카탈로그 순서가 앞선 항목이 이긴다(`>` 비교). 더 나은 답이라서가 아니라,
 * 같은 대본이 늘 같은 그림을 내야 하기 때문이다.
 */
export function matchClipart(text: string, catalog: ClipartEntry[]): ClipartEntry | null {
  if (!text.trim()) return null;

  let best: ClipartEntry | null = null;
  // 0에서 시작하므로 빈 별칭(`''`)은 절대 이기지 못한다. 빈 문자열은 어떤 문장에도
  // "들어 있어서", 카탈로그에 한 줄만 섞여도 그 캐릭터가 모든 씬을 먹는다.
  let bestLength = 0;

  for (const entry of catalog) {
    for (const term of [entry.keyword, ...entry.aliases]) {
      if (term.length > bestLength && text.includes(term)) {
        best = entry;
        bestLength = term.length;
      }
    }
  }
  return best;
}

/**
 * 그림이 public 아래에 놓일 자리. 앞 슬래시 없는 상대 경로다 — Remotion에 넘기는 미디어
 * 경로는 public 루트 기준이다.
 *
 * 파일명이 한국어라 URL 인코딩 문제를 낳을 수 있다. 이 저장소는 미디어 경로 때문에 이미
 * 한 번 크게 데었으므로(오디오가 렌더러에 닿지 못한 건) ASCII로 고정한다.
 *
 * 해시의 재료는 `file`이 아니라 `id`다. 같은 프리셋 그림을 여러 항목이 가리켜도 자리가
 * 갈려야 하고, 무엇보다 소유자가 다른 두 항목이 같은 자리를 쓰면 안 된다.
 */
export function clipartAssetKey(entry: ClipartEntry): string {
  return `clipart/${createHash('sha1').update(entry.id).digest('hex').slice(0, 10)}.png`;
}
