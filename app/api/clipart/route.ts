import { NextResponse } from 'next/server';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSessionFromRequest } from '@/lib/auth';
import { clipartAssetKey } from '@/lib/clipart';
import { addStudentClipart, catalogFor, newClipartId } from '@/lib/clipart-store';
import { selectArtifactStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * **PNG만 받는다.** 확장자 취향이 아니라 알파 채널 때문이다.
 *
 * 캐릭터는 이미 그려진 씬 **위에 얹힌다.** JPEG에는 투명도가 없으므로 JPG로 올린 캐릭터는
 * 영상 위에 불투명한 사각형으로 앉는다 — 조금 흐려지는 정도가 아니라 눈에 띄게 망가진
 * 영상이고, 수강생은 왜 그런지 알 방법이 없다. 올바른 결과를 낼 수 없는 형식을 받아 주는 건
 * 친절이 아니다. 운영자 프리셋 라이브러리의 그림이 전부 RGBA PNG인 이유도 같다.
 *
 * 이 결정이 `clipartAssetKey`가 확장자를 `.png`로 고정하는 것과 짝이다(`lib/clipart.ts`).
 * 한쪽만 되돌리면 확장자와 내용이 어긋난다.
 */
const ALLOWED_TYPES = new Set(['image/png']);

/**
 * 업로드 상한. 두 가지가 이 숫자를 정했다.
 *
 * 1) **Vercel 함수의 요청 본문 한도가 4.5MB다.** 그보다 큰 상한은 도달할 수 없는 숫자이고,
 *    수강생은 우리의 한국어 400 대신 플랫폼이 내는 413을 받는다 — 무엇을 해야 하는지 알 수 없는
 *    화면이다. 상한을 플랫폼 한도 **아래**에 두어야 거절이 우리 말로 나간다.
 * 2) 여기 올라오는 것은 캐릭터 그림 한 장이다. 운영자 프리셋 라이브러리의 그림이 장당 1MB
 *    안팎이므로 4MB면 여유가 네 배다. 정상적인 업로드가 이 선에 걸릴 일은 없다.
 *
 * 상한이 아예 없으면 로그인한 수강생 누구나 부를 수 있는 라우트가 Blob 요금과 함수 메모리를
 * 요청 한 번으로 먹는다.
 */
const MAX_UPLOAD_MB = 4;
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const TOO_LARGE_MESSAGE = `이미지가 너무 큽니다. ${MAX_UPLOAD_MB}MB 이하로 줄여서 올려 주세요.`;

/**
 * multipart 본문은 파일보다 조금 크다(경계 문자열·파트 헤더). 넉넉히 잡아 준다 —
 * 이 검사의 목적은 정확한 계산이 아니라 **파싱 전에 명백히 큰 요청을 끊는 것**이다.
 */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/**
 * 저장할 미디어 경로로 바꾼다.
 *
 * 두 구현의 반환값이 다르다: 로컬은 `/clipart/x.png`(앞 슬래시), 배포는 `https://...` 절대 URL.
 * 이 저장소의 규칙은 **public 루트 기준 상대 경로, 앞 슬래시 없이**다(`generated-audio/ab.mp3`).
 * `resolveAudioSrc`(`packages/video/src/utils/audioSrc.ts`)가 절대 URL과 상대 경로를 그 모양으로
 * 가르기 때문이다. 앞 슬래시를 그대로 두면 렌더는 성공하는데 그림만 조용히 빠진다 —
 * 이 저장소는 오디오 경로에서 정확히 같은 방식으로 한 번 데었다.
 */
function toStoredMediaPath(published: string): string {
  return /^https?:\/\//.test(published) ? published : published.replace(/^\/+/, '');
}

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** 이 수강생의 캐릭터 목록. 세션이 없으면 "누구 것"을 정할 수 없으므로 목록도 없다. */
export async function GET(request: Request) {
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  const { entries, usingPreset } = await catalogFor(ownerId);
  return NextResponse.json({ entries, usingPreset });
}

export async function POST(request: Request) {
  // 캐릭터에는 주인이 있어야 한다. 익명 업로드는 누구의 것도 아니게 되고,
  // 주인 없는 기록은 소유자 필터를 통과할 방법이 없다 — 목소리(`voicebox/clone`)와 같은 경계다.
  const ownerId = readSessionFromRequest(request);
  if (!ownerId) {
    return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  }

  // 본문을 통째로 메모리에 올리기 전에 한 번 끊는다. 헤더는 요청자가 쓰는 값이므로 이것만
  // 믿지 않고, 파싱 뒤 실제 크기로 다시 본다.
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES) {
    return badRequest(TOO_LARGE_MESSAGE);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return badRequest('multipart/form-data required');
  }

  // 소유자는 세션에서만 온다. FormData에 적힌 소유자를 믿으면 수강생 A가 B의 목록에
  // 캐릭터를 심을 수 있다.
  const keyword = String(form.get('keyword') ?? '').trim();
  const category = String(form.get('category') ?? '').trim();
  const aliases = String(form.get('aliases') ?? '')
    .split(',')
    .map((alias) => alias.trim())
    // 빈 별칭은 모든 문장에 "들어 있어서" 한 줄만 섞여도 그 캐릭터가 모든 씬을 먹는다
    // (`matchClipart` 주석). 여기서 버린다.
    .filter(Boolean);
  const image = form.get('image');

  // 키워드가 없는 항목은 어떤 대본에도 매칭될 수 없다. 저장해 봐야 목록만 채우는 죽은 줄이다.
  if (!keyword) {
    return badRequest('캐릭터를 찾을 키워드가 필요합니다.');
  }

  if (!(image instanceof Blob) || image.size === 0) {
    return badRequest('캐릭터 이미지 파일이 필요합니다.');
  }

  if (!ALLOWED_TYPES.has(image.type)) {
    // 무엇이 안 되는지가 아니라 **왜 안 되는지**를 말한다. "PNG만 됩니다"만 읽은 수강생은
    // JPG를 PNG로 변환해 다시 올리고 여전히 흰 네모를 얻는다. 배경이 투명해야 한다는 걸
    // 알아야 내보내기부터 다시 한다.
    return badRequest(
      '캐릭터 그림은 배경이 투명한 PNG여야 합니다. JPG처럼 투명 배경을 담지 못하는 형식으로 올리면'
      + ' 캐릭터가 영상 위에 흰 네모로 얹혀 보입니다.',
    );
  }

  if (image.size > MAX_UPLOAD_BYTES) {
    return badRequest(TOO_LARGE_MESSAGE);
  }

  /**
   * 순서가 중요하다: id를 먼저 만들고 → 그 id로 자리를 계산하고 → 그림을 올리고 →
   * **마지막에 한 번만** 저장한다. 저장이 id를 만들면 "id를 얻으려면 저장해야 하는데
   * 저장하려면 file이 필요하고 file을 얻으려면 id가 필요한" 순환이 된다(`newClipartId` 주석).
   * 이 순서라면 업로드가 실패했을 때 반쯤 저장된 항목이 남지 않는다.
   */
  const id = newClipartId();
  // `clipartAssetKey`는 `id`만 해싱한다. `file`은 아직 없는 값이라 자리만 차지한다.
  const key = clipartAssetKey({ id, ownerId, keyword, aliases, category, source: 'student', file: '' });

  // `publish`는 로컬 경로를 받는데 여기 있는 건 업로드된 바이트다. 임시 파일을 거쳐 넘기고,
  // 성공하든 실패하든 지운다.
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'clipart-upload-'));
  const tempPath = path.join(tempDir, path.basename(key));
  try {
    await writeFile(tempPath, Buffer.from(await image.arrayBuffer()));
    const published = await selectArtifactStore().publish(tempPath, key, image.type);
    const saved = await addStudentClipart({
      id,
      ownerId,
      keyword,
      aliases,
      category,
      file: toStoredMediaPath(published),
    });
    return NextResponse.json({ entry: saved });
  } catch (error) {
    // 그림을 못 올렸으면 아무것도 저장하지 않는다. 항목만 남으면 그 수강생의 카탈로그는
    // "자기 것이 하나 있는" 상태가 되어 프리셋으로 돌아가지도 못한 채 빈 그림을 낸다.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
