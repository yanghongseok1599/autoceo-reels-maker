import { describe, it, expect } from 'vitest';
import { readJsonObject, readString, readStringArray } from '@/lib/request-body';

/**
 * 라우트마다 try/catch를 복사하지 않으려고 한 곳에 모았다(`lib/voice-access.ts`와 같은 이유).
 * 모은 대신 그 한 곳이 정확해야 한다 — 여기가 그 확인이다.
 */

const post = (body: BodyInit | null) =>
  new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

describe('readJsonObject', () => {
  it('객체 본문은 그대로 돌려준다', async () => {
    expect(await readJsonObject(post('{"a": 1, "b": "두"}'))).toEqual({ a: 1, b: '두' });
  });

  it('중첩된 값도 잃지 않는다', async () => {
    expect(await readJsonObject(post('{"a": {"b": [1, 2]}}'))).toEqual({ a: { b: [1, 2] } });
  });

  it('빈 객체도 null이 아니라 빈 객체다 — "못 읽음"과 "비었음"은 다르다', async () => {
    expect(await readJsonObject(post('{}'))).toEqual({});
  });

  it('JSON이 아닌 본문에 던지지 않고 null을 돌려준다', async () => {
    expect(await readJsonObject(post('이건 JSON이 아닙니다'))).toBeNull();
  });

  it('중간에 끊긴 JSON도 null이다', async () => {
    expect(await readJsonObject(post('{"a": 1'))).toBeNull();
  });

  it('빈 본문과 본문 없음도 null이다', async () => {
    expect(await readJsonObject(post(''))).toBeNull();
    expect(await readJsonObject(post(null))).toBeNull();
  });

  /** 파싱은 되지만 이름 있는 필드를 읽을 수 없는 값들. */
  it('객체가 아닌 JSON은 전부 null이다', async () => {
    for (const body of ['null', '"대본"', '123', 'true', 'false', '0']) {
      expect(await readJsonObject(post(body)), body).toBeNull();
    }
  });

  /**
   * 배열은 `typeof`가 'object'라 따로 막지 않으면 통과한다. 통과시키면 `[]`에서 읽은
   * 필드가 전부 `undefined`가 되어 "빈 요청"과 구별되지 않는다.
   */
  it('배열은 객체가 아니다', async () => {
    expect(await readJsonObject(post('[]'))).toBeNull();
    expect(await readJsonObject(post('[{"a": 1}]'))).toBeNull();
  });
});

describe('readString', () => {
  it('문자열은 그대로 돌려준다', () => {
    expect(readString('대본')).toBe('대본');
  });

  it('빈 문자열과 공백 문자열도 문자열이다 — 다듬는 것은 부르는 쪽 몫이다', () => {
    expect(readString('')).toBe('');
    expect(readString('   ')).toBe('   ');
  });

  /** 이 값들이 그대로 흘러가면 뒤쪽 `.trim()`이 터져 500이 된다. */
  it('문자열이 아닌 값은 전부 undefined다', () => {
    for (const value of [123, 0, null, undefined, {}, [], ['대본'], true, false]) {
      expect(readString(value), JSON.stringify(value)).toBeUndefined();
    }
  });
});

describe('readStringArray', () => {
  it('문자열 배열은 그대로 돌려준다', () => {
    expect(readStringArray(['가', '나'])).toEqual(['가', '나']);
  });

  it('빈 배열은 빈 배열이다', () => {
    expect(readStringArray([])).toEqual([]);
  });

  /** `uniqueCompact`가 항목마다 `.trim()`을 부른다 — 숫자 하나가 500을 만들었다. */
  it('섞여 있으면 문자열만 남긴다', () => {
    expect(readStringArray(['가', 1, null, '나', {}])).toEqual(['가', '나']);
  });

  it('문자열이 하나도 없으면 빈 배열이다', () => {
    expect(readStringArray([1, 2, null])).toEqual([]);
  });

  it('배열이 아니면 undefined다', () => {
    for (const value of ['가', 123, null, undefined, {}, true]) {
      expect(readStringArray(value), JSON.stringify(value)).toBeUndefined();
    }
  });
});
