/**
 * 요청 본문을 **객체로만** 받아들인다.
 *
 * `app/api/auth/route.ts`가 먼저 이렇게 고쳐졌고 이유는 같다: `request.json()`을 그냥
 * 부르면 JSON이 아닌 본문에 500이 나가는데, 그건 "서버가 깨졌다"는 신호를 그냥 틀린
 * 요청에 주는 것이다 — 로그에서 진짜 장애와 섞이고, 부르는 쪽에는 다시 눌러 볼 이유를 준다.
 *
 * 라우트마다 try/catch를 복사하지 않는 이유는 `lib/voice-access.ts`에 적힌 것과 같다.
 * 복사하면 언젠가 한 곳이 뒤처지고, 뒤처진 그 한 곳이 구멍이다.
 *
 * 알려진 **동치 뮤턴트**가 둘 있다(뮤테이션 리포트에서 영원히 생존자로 남는다).
 * `body === null` 검사를 지워도 `null`이 그대로 반환되고, `catch` 본문을 비워도
 * `body`가 `undefined`라 아래 검사가 같은 `null`을 낸다. 둘 다 관측 가능한 차이가 없다 —
 * 남겨 둔 것은 타입 단언(`as Record`)이 거짓말이 되지 않게 하려는 것이다. 쫓지 말 것.
 *
 * @returns 못 읽었거나 객체가 아니면 `null`. **배열도 객체가 아니다** — 라우트가 기대하는
 *   것은 이름 있는 필드이고, `[]`에서 필드를 읽으면 전부 `undefined`가 나와 "빈 요청"과
 *   구별되지 않는다. 빈 요청처럼 다룰지 따로 거절할지는 부르는 쪽이 정한다.
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * 문자열이 아닌 값은 **없는 것**으로 본다.
 *
 * 본문을 감싸는 것만으로는 절반만 막힌다. `{"script": 123}`은 JSON으로 멀쩡히 파싱되지만
 * 그 다음 줄의 `.trim()`이 터져 똑같이 500이 된다 — `auth` 수정 때 `{"code": 123}`으로
 * 드러난 자리가 이것이고, 나머지 라우트에도 그대로 있었다. 여기서 `undefined`로 바꾸면
 * 라우트가 이미 갖고 있는 "…이 필요합니다" 검사가 그대로 받아 400을 낸다.
 */
export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * 문자열 배열만 통과시킨다. 배열이 아니면 없는 것으로 보고, 섞여 있으면 문자열만 남긴다.
 * `lib/learning-store.ts`의 `uniqueCompact`가 항목마다 `.trim()`을 부르는 자리다 —
 * `{"referenceNames": [1]}` 하나로 500이 났다.
 */
export function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === 'string');
}
