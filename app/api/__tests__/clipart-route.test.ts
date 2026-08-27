import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { GET, POST } from '../clipart/route';
import { signSession } from '@/lib/auth';
import { clipartAssetKey } from '@/lib/clipart';
import { listStudentClipart } from '@/lib/clipart-store';

let publicDir: string;

beforeEach(() => {
  process.env.SESSION_SECRET = 'test-secret';
  // 업로드가 저장소의 실제 public/으로 새어 나가지 않게 한다.
  publicDir = mkdtempSync(path.join(os.tmpdir(), 'reels-public-'));
  process.env.PUBLIC_DIR = publicDir;
  // 프리셋 카탈로그는 저장소에 커밋돼 있다(`data/preset-clipart-catalog.json`). 그래서 이
  // 검사는 운영자 Codex 스킬 디렉터리가 있든 없든 같은 답을 본다 — `CLIPART_PRESET_DIR`은
  // 이제 워커가 그림 바이트를 찾는 데만 쓰이므로 여기서 가리킬 곳이 없다.
});

function req(method: string, ownerId?: string, body?: BodyInit) {
  return new Request('http://localhost/api/clipart', {
    method,
    headers: ownerId ? { Cookie: `student_session=${signSession(ownerId)}` } : {},
    body,
  });
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * 1x1 PNG를 **진짜로** 만든다 — 시그니처·IHDR·(팔레트면 PLTE)·(요청하면 tRNS)·IDAT·IEND에
 * 실제 CRC까지.
 *
 * 예전 픽스처는 `'PNG' + 'DATA'`라는 문자열이었다. PNG가 아닌 바이트를 행복 경로에 놓고도
 * 초록불이었다는 뜻이고, 그래서 "라벨만 보고 통과시킨다"는 결함을 이 파일이 잡지 못했다.
 * 픽스처가 가짜면 통과는 아무것도 증명하지 않는다.
 */
function png(colorType: 0 | 2 | 3 | 4 | 6, options: { trns?: boolean } = {}): Uint8Array<ArrayBuffer> {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);   // width
  ihdr.writeUInt32BE(1, 4);   // height
  ihdr[8] = 8;                // bit depth
  ihdr[9] = colorType;

  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)];
  if (colorType === 3) parts.push(chunk('PLTE', Buffer.from([0xff, 0xff, 0xff])));
  if (options.trns) parts.push(chunk('tRNS', Buffer.from([0x00])));
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  parts.push(chunk('IDAT', deflateSync(Buffer.concat([Buffer.alloc(1), Buffer.alloc(channels)]))));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return new Uint8Array(Buffer.concat(parts));
}

/** 캐릭터가 실제로 이래야 하는 모양: 알파 채널이 있는 RGBA PNG. */
const TRANSPARENT_PNG = png(6);
/** 흰 배경 위에 내보낸 진짜 PNG. 파일로서는 멀쩡하고 캐릭터로서는 흰 네모다. */
const OPAQUE_PNG = png(2);
/**
 * 진짜 JPEG의 앞부분(SOI + JFIF APP0).
 *
 * 길이를 넉넉히 두고 **26번째 바이트를 일부러 `0x06`으로 둔다.** 그 자리는 PNG였다면 IHDR의
 * color type이 놓일 곳이고 `0x06`은 RGBA다. 시그니처 검사를 지우면 이 바이트가 "알파 채널이
 * 있다"로 읽혀 통과해 버린다 — 픽스처가 짧으면 그 자리가 비어 있어서 검사를 지워도 우연히
 * 막히고, 그러면 이 테스트는 아무것도 증명하지 못한다.
 */
const JPEG_BYTES = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
  0x00, 0x06, 0x04, 0x05, 0x06, 0x05, 0x04, 0x06, 0x06, 0x05, 0x06, 0x07,
]);

function blob(bytes: Uint8Array<ArrayBuffer>, type: string) {
  return new Blob([bytes], { type });
}

function form(keyword: string, image?: Blob) {
  const fd = new FormData();
  fd.append('image', image ?? blob(TRANSPARENT_PNG, 'image/png'), 'c.png');
  fd.append('keyword', keyword);
  fd.append('aliases', '별칭1,별칭2');
  fd.append('category', '감정');
  return fd;
}

describe('GET /api/clipart', () => {
  it('rejects an unauthenticated request', async () => {
    expect((await GET(req('GET'))).status).toBe(401);
  });

  it('reports the preset fallback for a new student', async () => {
    const body = await (await GET(req('GET', 'u1'))).json();
    expect(body.usingPreset).toBe(true);
  });

  // 서명이 없으면 쿠키는 인증이 아니라 자기신고다. `student_session=u1`만 보내면
  // 누구나 u1의 캐릭터 목록을 열게 된다.
  it('rejects a forged session cookie', async () => {
    const res = await GET(new Request('http://localhost/api/clipart', {
      headers: { Cookie: 'student_session=u1' },
    }));
    expect(res.status).toBe(401);
  });
});

describe('POST /api/clipart', () => {
  it('rejects an unauthenticated upload', async () => {
    expect((await POST(req('POST', undefined, form('기쁨')))).status).toBe(401);
  });

  it('rejects an upload with no keyword', async () => {
    const fd = form('');
    expect((await POST(req('POST', 'u1', fd))).status).toBe(400);
  });

  it('stores an upload against the caller', async () => {
    expect((await POST(req('POST', 'u1', form('기쁨')))).status).toBe(200);
    const body = await (await GET(req('GET', 'u1'))).json();
    expect(body.usingPreset).toBe(false);
    expect(body.entries.map((e: { keyword: string }) => e.keyword)).toEqual(['기쁨']);
  });

  // 업로드한 뒤에도 다른 수강생 목록은 그대로여야 한다.
  it('does not leak an upload into another student catalog', async () => {
    await POST(req('POST', 'u1', form('기쁨')));
    const other = await (await GET(req('GET', 'u2'))).json();
    expect(other.usingPreset).toBe(true);
  });

  /**
   * 위 검사는 `usingPreset`만 본다. 경계 자체는 목록의 내용으로 눌러 둔다 — 프리셋이
   * 비어 있어도 u2의 목록에 u1의 키워드가 섞이면 안 된다.
   */
  it("never shows one student the other student's uploaded character", async () => {
    await POST(req('POST', 'u1', form('기쁨')));
    await POST(req('POST', 'u2', form('슬픔')));
    const mine = await (await GET(req('GET', 'u1'))).json();
    const theirs = await (await GET(req('GET', 'u2'))).json();
    expect(mine.entries.map((e: { keyword: string }) => e.keyword)).toEqual(['기쁨']);
    expect(theirs.entries.map((e: { keyword: string }) => e.keyword)).toEqual(['슬픔']);
  });

  // FormData는 요청자가 만든다. 거기 적힌 소유자를 믿으면 u1이 u2의 목록에 캐릭터를 심는다.
  it('takes the owner from the session, never from the form data', async () => {
    const fd = form('기쁨');
    fd.append('ownerId', 'u2');
    expect((await POST(req('POST', 'u1', fd))).status).toBe(200);
    expect((await listStudentClipart('u1')).map((e) => e.keyword)).toEqual(['기쁨']);
    expect(await listStudentClipart('u2')).toEqual([]);
  });

  it('rejects an upload with no image', async () => {
    const fd = new FormData();
    fd.append('keyword', '기쁨');
    expect((await POST(req('POST', 'u1', fd))).status).toBe(400);
  });

  /**
   * PNG만 받는다. 이 라우트가 돌려주는 경로는 그대로 `<img>`와 Remotion `<Img>`에 들어간다.
   * SVG나 임의 바이트를 통과시키면 렌더가 조용히 빈 그림을 내거나, 남의 브라우저에서 실행되는
   * 마크업을 그 수강생 이름으로 서빙하게 된다.
   */
  it('rejects a file that is not a png', async () => {
    const gif = new Blob(['GIF89a'], { type: 'image/gif' });
    const res = await POST(req('POST', 'u1', form('기쁨', gif)));
    expect(res.status).toBe(400);
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * JPEG는 **형식 취향의 문제가 아니다.** 캐릭터는 이미 그려진 씬 위에 얹히는데 JPEG에는
   * 알파 채널이 없다. 통과시키면 수강생의 릴스에 불투명한 흰 사각형이 박힌 채로 나가고,
   * 200을 받은 수강생은 왜 그런지 알 방법이 없다.
   */
  it('rejects a jpeg because a character with no alpha channel lands as a white box', async () => {
    const res = await POST(req('POST', 'u1', form('기쁨', blob(JPEG_BYTES, 'image/jpeg'))));
    expect(res.status).toBe(400);
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * **이 검사가 이 라운드의 핵심이다.**
   *
   * multipart 파트의 `Content-Type`은 올리는 쪽이 정한다. 그리고 이건 공격자만 밟는 길이
   * 아니다 — "PNG여야 합니다"를 읽은 수강생이 Finder에서 `char.jpg`를 `char.png`로 이름만
   * 바꾸면 OS가 확장자를 보고 `image/png`를 붙여 준다. 라벨만 보는 검사는 다시 내보낸
   * 수강생은 걸러 내고 이름만 바꾼 수강생은 통과시킨다 — 정확히 거꾸로다.
   */
  it('rejects jpeg bytes that claim to be a png, however the label was set', async () => {
    const renamed = new File([JPEG_BYTES], 'char.png', { type: 'image/png' });
    const res = await POST(req('POST', 'u1', form('기쁨', renamed)));
    expect(res.status).toBe(400);
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * 거절 문구가 약속한 것을 검사가 실제로 봐야 한다. 흰 배경 위에 내보낸 RGB PNG는 파일로서는
   * 완전한 PNG이고, 통과시키면 우리가 문구에 적은 바로 그 흰 네모가 영상에 박힌다.
   */
  it('rejects a real png that has no alpha channel at all', async () => {
    const res = await POST(req('POST', 'u1', form('기쁨', blob(OPAQUE_PNG, 'image/png'))));
    expect(res.status).toBe(400);
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  // 팔레트 PNG는 알파 채널 대신 `tRNS` 청크로 투명도를 싣는다. 있으면 받고, 없으면 거절이다.
  it('accepts a palette png only when it carries a tRNS chunk', async () => {
    expect((await POST(req('POST', 'u1', form('기쁨', blob(png(3), 'image/png'))))).status)
      .toBe(400);
    expect((await POST(req('POST', 'u1', form('기쁨', blob(png(3, { trns: true }), 'image/png')))))
      .status).toBe(200);
  });

  it('accepts a greyscale png that carries an alpha channel', async () => {
    expect((await POST(req('POST', 'u1', form('기쁨', blob(png(4), 'image/png'))))).status)
      .toBe(200);
  });

  /**
   * 거절 문구는 제약을 **가르쳐야** 한다. "PNG만 됩니다"만 읽은 수강생은 JPG를 PNG로 변환해
   * 다시 올리고 여전히 흰 네모를 얻는다 — 변환은 없던 투명 배경을 만들어 내지 못한다.
   */
  it('tells the student the background must be transparent, not merely that it must be a png', async () => {
    const notPng = await (await POST(req('POST', 'u1', form('기쁨', blob(JPEG_BYTES, 'image/png'))))).json();
    const noAlpha = await (await POST(req('POST', 'u1', form('기쁨', blob(OPAQUE_PNG, 'image/png'))))).json();
    expect(notPng.error).toContain('투명');
    expect(noAlpha.error).toContain('투명');
  });

  /**
   * 두 거절은 원인도 해법도 다르다. "이건 PNG가 아니다"와 "이 PNG엔 투명도가 없다"에 같은
   * 문장을 주면 수강생은 같은 잘못된 처방을 두 번 시도한다.
   */
  it('gives the two rejections different sentences', async () => {
    const notPng = await (await POST(req('POST', 'u1', form('기쁨', blob(JPEG_BYTES, 'image/png'))))).json();
    const noAlpha = await (await POST(req('POST', 'u1', form('기쁨', blob(OPAQUE_PNG, 'image/png'))))).json();
    expect(notPng.error).not.toBe(noAlpha.error);
    // 이름만 바꾼 수강생에게는 그게 통하지 않는다는 걸 알려야 한다.
    expect(notPng.error).toContain('.png');
  });

  /**
   * 로그인한 수강생 누구나 부를 수 있는 업로드 라우트다. 상한이 없으면 한 번의 요청이
   * Blob 요금과 함수 메모리를 그대로 먹는다. 거절 문구에 상한을 적어 둬야 수강생이
   * 무엇을 해야 하는지 안다.
   */
  it('rejects an image larger than the cap and says the cap out loud', async () => {
    const huge = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'image/png' });
    const res = await POST(req('POST', 'u1', form('기쁨', huge)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('4MB');
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * 상한은 두 번 본다. 이건 **파싱 전** 한 번 — `Content-Length`가 명백히 큰 요청을 본문을
   * 메모리에 올리기 전에 끊는다.
   *
   * 비어 있지 않다는 걸 증명하려고 multipart로 파싱될 수 없는 본문(`'x'`)을 보낸다. 라우트가
   * 파싱까지 갔다면 "multipart/form-data required"가 나왔을 것이다. 크기 문구가 나온다는 것은
   * 파싱 전에 끊었다는 뜻이다.
   */
  it('rejects an oversized request before it parses the body at all', async () => {
    const res = await POST(new Request('http://localhost/api/clipart', {
      method: 'POST',
      headers: {
        Cookie: `student_session=${signSession('u1')}`,
        'Content-Length': String(64 * 1024 * 1024),
      },
      body: 'x',
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('4MB');
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * 헤더는 올리는 쪽이 쓰는 값이므로 그것만 믿지 않는다. 작게 적어 보내도 파싱 뒤 실제
   * 크기가 판정한다 — 이쪽이 진짜 상한이고 헤더 검사는 그 앞의 편의다.
   */
  it('still rejects an oversized image when the content-length header lies', async () => {
    const huge = new Blob([new Uint8Array(4 * 1024 * 1024 + 1)], { type: 'image/png' });
    const res = await POST(new Request('http://localhost/api/clipart', {
      method: 'POST',
      headers: { Cookie: `student_session=${signSession('u1')}`, 'Content-Length': '10' },
      body: form('기쁨', huge),
    }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('4MB');
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * 저장하는 경로는 public 루트 기준 상대 경로여야 한다 — **앞 슬래시 없이**.
   * `fileArtifactStore.publish`는 `/clipart/x.png`를 돌려주므로 그대로 저장하면
   * 렌더가 `//clipart/x.png`를 찾다 그림 없이 성공한다. 이 저장소는 오디오에서
   * 정확히 같은 방식으로 한 번 데었다.
   */
  it('stores a public-root-relative path with no leading slash, and the bytes are there', async () => {
    expect((await POST(req('POST', 'u1', form('기쁨')))).status).toBe(200);
    const [saved] = await listStudentClipart('u1');
    expect(saved.file.startsWith('/')).toBe(false);
    expect(saved.file).toBe(clipartAssetKey(saved));
    expect(existsSync(path.join(publicDir, saved.file))).toBe(true);
    expect(readFileSync(path.join(publicDir, saved.file)).equals(Buffer.from(TRANSPARENT_PNG)))
      .toBe(true);
  });

  it('marks the stored entry as student source and splits aliases on commas', async () => {
    await POST(req('POST', 'u1', form('기쁨')));
    const [saved] = await listStudentClipart('u1');
    expect(saved.source).toBe('student');
    expect(saved.aliases).toEqual(['별칭1', '별칭2']);
    expect(saved.category).toBe('감정');
  });

  it('drops empty alias fragments rather than storing a term that matches everything', async () => {
    const fd = form('기쁨');
    fd.set('aliases', '행복, ,,웃음,');
    await POST(req('POST', 'u1', fd));
    expect((await listStudentClipart('u1'))[0].aliases).toEqual(['행복', '웃음']);
  });

  /**
   * 한 글자 term 금지는 프리셋 로더에만 있으면 반쪽이다. Task 1 실측에서 현실적인 대본
   * 14줄 중 12줄이 오검출했고 가장 큰 단일 원인이 한 글자 term이었다 — `준비 자세부터`가
   * `비`에, `돈다면`이 `돈`에 걸렸다. 그 규칙이 운영자 카탈로그에만 걸려 있으면 수강생은
   * 자기 카탈로그에서 똑같은 고장을 그대로 다시 겪는다.
   */
  it('rejects a one-character keyword, the largest measured cause of false matches', async () => {
    const res = await POST(req('POST', 'u1', form('비')));
    expect(res.status).toBe(400);
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  // 별칭도 `matchClipart`가 똑같이 쓰는 term이다. 하나만 한 글자여도 결과는 같다.
  it('rejects a one-character alias too, since matching uses aliases the same way', async () => {
    const fd = form('기쁨');
    fd.set('aliases', '행복,비');
    const res = await POST(req('POST', 'u1', fd));
    expect(res.status).toBe(400);
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * 조용히 솎아 내지 않는다. 프리셋 로더는 그렇게 해도 되지만(운영자 자신의 카탈로그다),
   * 수강생 업로드를 조용히 버리면 "비슷한 말을 넣었는데 안 먹는다"가 되고 이유가 화면
   * 어디에도 없다.
   */
  it('rejects rather than silently dropping the short alias', async () => {
    const fd = form('기쁨');
    fd.set('aliases', '행복,비');
    await POST(req('POST', 'u1', fd));
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  /**
   * 거절 문구는 규칙이 아니라 **원리**를 가르쳐야 한다. `두 글자 이상 쓰세요`만 읽은 수강생은
   * 임의의 제약으로 이해하고 아무 글자나 덧붙인다. 위험은 반대쪽이다 — 한 글자 낱말이
   * 상관없는 장면마다 캐릭터를 불러낸다는 사실을 알아야 제대로 된 낱말을 고른다.
   */
  it('says why a one-character term is refused, not merely that it is', async () => {
    const body = await (await POST(req('POST', 'u1', form('비')))).json();
    expect(body.error).toContain('"비"');           // 무엇이 문제인지
    expect(body.error).toContain('다른 낱말 안에');   // 왜 문제인지
    expect(body.error).toContain('준비');            // 실측 예
    expect(body.error).toContain('2글자 이상');       // 무엇을 하면 되는지
  });

  // 두 자리의 거절은 어느 칸을 고쳐야 하는지 서로 달라야 한다.
  it('names the field it refused, so the student knows which box to fix', async () => {
    const byKeyword = await (await POST(req('POST', 'u1', form('비')))).json();
    const fd = form('기쁨');
    fd.set('aliases', '비');
    const byAlias = await (await POST(req('POST', 'u1', fd))).json();
    expect(byKeyword.error).toContain('키워드');
    expect(byAlias.error).toContain('비슷한 말');
  });

  it('accepts a two-character keyword — the rule is a floor, not a ban on short words', async () => {
    expect((await POST(req('POST', 'u1', form('기쁨')))).status).toBe(200);
  });

  /**
   * 같은 키워드를 다시 올리는 것은 **고치는 행위다.** 덧붙이면 같은 키워드 항목이 둘 남고
   * `matchClipart`는 동점일 때 앞선 항목을 고르므로 새 그림이 절대 이기지 못한다 —
   * 수강생 눈에는 "다시 올렸는데 안 바뀐다"가 되고, 잘못 고른 키워드를 고칠 길이 막힌다.
   */
  it('replaces the character when the same keyword is uploaded again', async () => {
    await POST(req('POST', 'u1', form('기쁨', blob(png(6), 'image/png'))));
    const [first] = await listStudentClipart('u1');

    await POST(req('POST', 'u1', form('기쁨', blob(png(4), 'image/png'))));
    const mine = await listStudentClipart('u1');

    expect(mine).toHaveLength(1);
    // 새 id → 새 자리. 옛 그림을 덮지 않으므로 진행 중인 렌더가 가져가는 파일이 바뀌지 않는다.
    expect(mine[0].id).not.toBe(first.id);
    expect(mine[0].file).not.toBe(first.file);
    expect(mine[0].file).toBe(clipartAssetKey(mine[0]));
    expect(existsSync(path.join(publicDir, mine[0].file))).toBe(true);
    // 지우는 게 아니다 — 옛 그림은 그대로 남는다. 없는 파일을 가리키는 렌더가 생기지 않는다.
    expect(existsSync(path.join(publicDir, first.file))).toBe(true);
  });

  /**
   * 업로드가 실패하면 아무것도 남지 않아야 한다. 항목만 저장되고 그림이 없으면 그 수강생의
   * 카탈로그는 프리셋으로 되돌아가지도 못한 채(자기 것이 하나 있으니) 그림 없는 씬만 낸다.
   *
   * public 자리를 디렉터리가 아닌 파일로 만들어 publish를 실패시킨다.
   */
  it('saves nothing when publishing the image fails', async () => {
    const notADir = path.join(mkdtempSync(path.join(os.tmpdir(), 'reels-public-')), 'a-file');
    writeFileSync(notADir, 'not a directory');
    process.env.PUBLIC_DIR = notADir;

    const res = await POST(req('POST', 'u1', form('기쁨')));
    expect(res.status).toBe(502);
    expect(await listStudentClipart('u1')).toEqual([]);
  });
});
