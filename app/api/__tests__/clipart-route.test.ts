import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
  // 프리셋 디렉터리는 운영자 기계에만 있다. 빈 곳을 가리켜서 테스트가 그 기계의 실제
  // 라이브러리 내용에 따라 달라지지 않게 한다.
  process.env.CLIPART_PRESET_DIR = mkdtempSync(path.join(os.tmpdir(), 'clipart-preset-'));
});

function req(method: string, ownerId?: string, body?: BodyInit) {
  return new Request('http://localhost/api/clipart', {
    method,
    headers: ownerId ? { Cookie: `student_session=${signSession(ownerId)}` } : {},
    body,
  });
}

function form(keyword: string, image?: Blob) {
  const fd = new FormData();
  fd.append('image', image ?? new Blob(['PNGDATA'], { type: 'image/png' }), 'c.png');
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
   * PNG·JPG만 받는다. 이 라우트가 돌려주는 경로는 그대로 `<img>`와 Remotion `<Img>`에 들어간다.
   * SVG나 임의 바이트를 통과시키면 렌더가 조용히 빈 그림을 내거나, 남의 브라우저에서 실행되는
   * 마크업을 그 수강생 이름으로 서빙하게 된다.
   */
  it('rejects a file that is not a png or jpeg', async () => {
    const gif = new Blob(['GIF89a'], { type: 'image/gif' });
    const res = await POST(req('POST', 'u1', form('기쁨', gif)));
    expect(res.status).toBe(400);
    expect(await listStudentClipart('u1')).toEqual([]);
  });

  it('accepts a jpeg as well as a png', async () => {
    const jpeg = new Blob(['JPEGDATA'], { type: 'image/jpeg' });
    expect((await POST(req('POST', 'u1', form('기쁨', jpeg)))).status).toBe(200);
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
    expect(readFileSync(path.join(publicDir, saved.file), 'utf8')).toBe('PNGDATA');
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
