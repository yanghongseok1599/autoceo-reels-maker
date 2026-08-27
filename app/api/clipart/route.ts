import { NextResponse } from 'next/server';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readSessionFromRequest } from '@/lib/auth';
import { MIN_TERM_LENGTH, clipartAssetKey } from '@/lib/clipart';
import { addStudentClipart, catalogFor, newClipartId } from '@/lib/clipart-store';
import { selectArtifactStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * **PNG만 받는다. 그리고 그 판정을 `File.type`으로 하지 않는다.**
 *
 * 왜 PNG만인가: 캐릭터는 이미 그려진 씬 **위에 얹힌다.** JPEG에는 알파 채널이 없으므로 JPG로
 * 올린 캐릭터는 영상 위에 불투명한 사각형으로 앉는다 — 조금 흐려지는 정도가 아니라 눈에 띄게
 * 망가진 영상이고, 수강생은 왜 그런지 알 방법이 없다. 운영자 프리셋 라이브러리의 그림이 전부
 * RGBA PNG인 이유도 같다.
 *
 * 왜 라벨을 믿지 않는가: multipart 파트의 `Content-Type`은 **올리는 쪽이 정한다.** 게다가
 * 이건 공격자만 밟는 길이 아니다. "PNG여야 합니다"를 읽은 수강생이 Finder에서 `char.jpg`를
 * `char.png`로 이름만 바꾸면 OS가 확장자를 보고 `image/png`를 붙여 준다 — 다시 내보내기보다
 * 훨씬 자연스러운 반응이다. 라벨만 보면 조심한 수강생은 걸러 내고 정작 걸러야 할 수강생은
 * 통과시키는 검사가 된다. 그래서 실제 바이트를 본다.
 *
 * 이 결정이 `clipartAssetKey`가 확장자를 `.png`로 고정하는 것과 짝이다(`lib/clipart.ts`).
 */

/** PNG 파일의 첫 8바이트. 이것만이 "PNG인가"에 대한 신뢰할 수 있는 답이다. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR의 color type이 놓인 자리: 시그니처 8 + 길이 4 + `IHDR` 4 + 폭 4 + 높이 4 + 비트깊이 1. */
const IHDR_COLOR_TYPE_OFFSET = 25;

/** color type 4(회색+알파)·6(RGBA)는 알파 채널을 **가지고 있다**. */
const ALPHA_COLOR_TYPES = new Set([4, 6]);

/** color type 3(팔레트)은 알파 채널 대신 `tRNS` 청크로 투명도를 싣는다. */
const PALETTE_COLOR_TYPE = 3;

function looksLikePng(bytes: Buffer): boolean {
  return bytes.length > IHDR_COLOR_TYPE_OFFSET
    && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

/**
 * PNG 청크를 순서대로 걸어가며 그 타입이 있는지 본다.
 *
 * `bytes.includes('tRNS')`로 훑지 않는 이유: 그건 픽셀 데이터 안에 우연히 같은 네 글자가
 * 들어 있어도 참이 된다. 투명하지 않은 그림을 투명하다고 답하는 쪽의 실수라 값이 싸지 않다.
 */
function hasChunk(bytes: Buffer, type: string): boolean {
  // 시그니처 다음이 첫 청크다.
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= bytes.length) {
    if (bytes.subarray(at + 4, at + 8).toString('latin1') === type) return true;
    // 길이 4 + 타입 4 + 데이터 + CRC 4. 최소 12씩 나아가므로 깨진 길이로도 멈춘다.
    at += 12 + bytes.readUInt32BE(at);
  }
  return false;
}

/**
 * 투명 배경을 **담을 수 있는** PNG인가.
 *
 * 알파 채널이 아예 없는 PNG는 투명 배경일 수가 없다. 흰 배경 위에 내보낸 RGB PNG가
 * 그대로 통과하면 우리가 거절 문구에 적은 바로 그 흰 네모가 영상에 박힌다 — 문구가 약속한
 * 것과 검사가 보는 것이 어긋나면 안 된다.
 *
 * **여기서 못 잡는 것**: 알파 채널이 있는데 모든 픽셀이 불투명한 RGBA PNG. 그건 픽셀을
 * 열어 봐야 알 수 있고, 그 비용은 이 경계에서 치를 값이 아니다(리포트에 한계로 적어 뒀다).
 */
function canHoldTransparency(bytes: Buffer): boolean {
  const colorType = bytes[IHDR_COLOR_TYPE_OFFSET];
  if (ALPHA_COLOR_TYPES.has(colorType)) return true;
  if (colorType === PALETTE_COLOR_TYPE) return hasChunk(bytes, 'tRNS');
  return false;
}

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

/**
 * 한 글자 term 거절 문구.
 *
 * **왜 거르지 않고 거절하는가**: 프리셋 로더는 한 글자 별칭을 조용히 솎아 낸다
 * (`lib/clipart-preset.ts`) — 그건 운영자 자신의 카탈로그라 손질이고, 운영자는 그 규칙을
 * 안다. 수강생 업로드는 다르다. 조용히 버리면 "비슷한 말을 넣었는데 안 먹는다"가 되고,
 * 안 먹는 이유가 화면 어디에도 없다.
 *
 * **왜 이유를 적는가**: `두 글자 이상 입력하세요`만 읽은 수강생은 규칙을 임의의 제약으로
 * 이해하고 아무 글자나 덧붙인다. 실제 위험은 그 반대쪽이다 — 한 글자 낱말은 상관없는 장면마다
 * 캐릭터를 불러내고, 수강생은 자기가 고른 키워드와 그 고장을 연결하지 못한다. 실측 예를
 * 그대로 적어 두면 규칙이 아니라 원리가 전달된다.
 */
function tooShortTerm(subject: string, term: string, fix: string) {
  return `${subject} 한 글자입니다: "${term}". 한 글자 낱말은 다른 낱말 안에 그대로 들어 있어서`
    + ' 상관없는 장면에도 이 캐릭터가 나옵니다 — "비"는 준비·대비·비타민에, "돈"은 돈다면에'
    + ` 걸립니다. ${MIN_TERM_LENGTH}글자 이상으로 ${fix}.`;
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

  /**
   * 한 글자 term은 저장하지 않는다. 프리셋 카탈로그가 이 규칙으로 실측 오검출을 몰아냈는데
   * (`MIN_TERM_LENGTH` 주석: `비` ⊂ 준비·대비, `돈` ⊂ 돈다면), 그 검사가 프리셋 로더에만
   * 걸려 있으면 수강생은 자기 카탈로그에서 똑같은 고장을 그대로 다시 겪는다. 게다가 그때는
   * 자기가 고른 낱말이 원인이라는 걸 짐작할 방법이 없다 — 릴스 전체에 엉뚱한 캐릭터가 나오는데
   * 화면 어디에도 이유가 없다.
   *
   * 키워드와 별칭 **둘 다** 본다. 별칭도 `matchClipart`가 똑같이 쓰는 term이라, 별칭 하나만
   * 한 글자여도 결과는 같다.
   */
  if (keyword.length < MIN_TERM_LENGTH) {
    return badRequest(tooShortTerm('키워드가', keyword, '적어 주세요'));
  }

  const shortAlias = aliases.find((alias) => alias.length < MIN_TERM_LENGTH);
  if (shortAlias) {
    return badRequest(tooShortTerm('비슷한 말이', shortAlias, '적거나 지워 주세요'));
  }

  if (!(image instanceof Blob) || image.size === 0) {
    return badRequest('캐릭터 이미지 파일이 필요합니다.');
  }

  if (image.size > MAX_UPLOAD_BYTES) {
    return badRequest(TOO_LARGE_MESSAGE);
  }

  // 바이트를 여기서 한 번 읽어 검사와 저장에 같이 쓴다. 크기 상한을 통과한 뒤라 안전하다.
  const bytes = Buffer.from(await image.arrayBuffer());

  // 두 거절은 원인도 해법도 다르다. 같은 문장을 주면 수강생은 같은 잘못된 처방을 두 번 시도한다.
  if (!looksLikePng(bytes)) {
    return badRequest(
      'PNG 파일이 아닙니다. 확장자만 .png로 바꾼 JPG는 PNG가 되지 않습니다 —'
      + ' 그림 도구에서 배경을 지우고 투명 PNG로 다시 내보내 주세요.',
    );
  }

  if (!canHoldTransparency(bytes)) {
    return badRequest(
      '이 PNG에는 투명 배경이 없습니다. 캐릭터는 영상 위에 얹히기 때문에 흰 배경이 그대로'
      + ' 네모로 함께 보입니다. 배경을 지운 뒤 투명도를 포함해 저장한 PNG로 올려 주세요.',
    );
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
    await writeFile(tempPath, bytes);
    // 라벨이 아니라 검사를 통과한 사실로 타입을 정한다. `image.type`은 올리는 쪽이 쓴 값이다.
    const published = await selectArtifactStore().publish(tempPath, key, 'image/png');
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
