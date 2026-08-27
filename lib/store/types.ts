/**
 * `list` 한 번이 돌려주는 키의 상한. `@vercel/blob`의 `list` 기본값과 같은 값을 쓰고,
 * 파일 구현도 같은 값으로 자른다 — 두 구현이 다른 개수를 돌려주면, 배포에서만 다르게
 * 동작하는 코드가 되고 그건 이 프로젝트가 이미 한 번 겪은 사고다.
 *
 * 잘라낸다는 것은 곧 **키가 이보다 많으면 전부 보이지 않는다**는 뜻이다. 지금 유일한
 * 호출자(잡 고아 쓸기)에게는 안전한 실패다 — 못 본 것을 지우지 않고 그냥 다음 기회로 넘긴다.
 */
export const STORE_LIST_LIMIT = 1000;

export interface Store {
  read<T>(key: string, fallback: T): Promise<T>;
  write<T>(key: string, value: T): Promise<void>;
  /**
   * `prefix`로 시작하는 키들을 돌려준다. **값이 아니라 키**다 — 부르는 쪽이 무엇이
   * 있는지만 알면 되는 자리에서 저장소 전체를 읽어 오지 않게 하려는 것이다.
   *
   * 키에는 `.json` 같은 저장 형식이 붙지 않는다. 그건 구현의 사정이지 부르는 쪽의 사정이 아니다.
   * 없는 prefix는 오류가 아니라 빈 배열이다. 최대 `STORE_LIST_LIMIT`개까지만 돌려준다.
   */
  list(prefix: string): Promise<string[]>;
}

/**
 * 렌더가 끝난 MP4처럼 **JSON이 아닌 바이너리 산출물**을 다루는 저장소.
 *
 * `Store`와 분리한 이유: `Store`는 읽기-수정-쓰기로 작은 JSON을 다루는 인터페이스고,
 * 여기 필요한 건 "워커 디스크에 있는 파일 하나를 브라우저가 열 수 있는 URL로 바꾸기"다.
 * 두 요구가 한 인터페이스에 섞이면 구현체가 둘 다 어중간해진다.
 */
export interface ArtifactStore {
  kind: 'file' | 'blob';
  /**
   * `localPath`의 파일을 `key` 위치에 올리고, 브라우저가 그대로 `<video src>`에 넣을 수 있는
   * URL을 돌려준다. 로컬 구현은 `/renders/job_x.mp4` 같은 앱 상대 경로를, 배포 구현은
   * `https://...blob.vercel-storage.com/...` 절대 URL을 돌려준다.
   *
   * `key`는 저장소 안의 경로다(예: `renders/job_x.mp4`). 앞의 `/`나 `..`는 허용하지 않는다.
   *
   * `contentType`은 **배포 구현에서만 의미가 있다.** Blob은 올릴 때 정한 값을 그대로
   * 응답 헤더에 박아 서빙하므로, PNG를 기본값 그대로 올리면 이미지가 `video/mp4`로 나가
   * 브라우저와 렌더러 양쪽에서 깨진다. 로컬 구현은 파일을 `public/` 아래로 복사할 뿐이고
   * 타입은 개발 서버가 확장자로 정하기 때문에 이 값을 쓰지 않는다 — **그래서 이 실수는
   * 로컬에서 멀쩡해 보이고 배포에서만 터진다.**
   *
   * 기본값이 `video/mp4`인 것은 기존 호출자(렌더 워커)를 그대로 두기 위해서다.
   */
  publish(localPath: string, key: string, contentType?: string): Promise<string>;
}

/** 저장소 밖으로 나가는 key를 막는다. 워커가 보내는 값이므로 신뢰하지 않는다. */
export function assertSafeKey(key: string): void {
  if (!key || key.startsWith('/') || key.split('/').includes('..')) {
    throw new Error(`저장소 키가 올바르지 않습니다: ${key}`);
  }
}

/**
 * JSON 저장소(`Store`) 키 검증. 키가 이제 `ownerId`·`jobId` 같은 값으로 만들어지므로,
 * 그중 하나라도 신뢰 밖이면 저장소 바깥 파일을 읽고 쓸 수 있다.
 *
 * 위의 `assertSafeKey`(아티팩트 저장소용)와 규칙은 같지만 일부러 따로 둔다. 둘은 호출자가
 * 다른 별개의 인터페이스라, 한쪽 규칙을 고치다 다른 쪽을 조용히 깨뜨리지 않게 하기 위해서다.
 */
export function assertSafeStoreKey(key: string): void {
  if (!key || key.startsWith('/') || key.split('/').includes('..')) {
    throw new Error(`저장소 키가 올바르지 않습니다: ${key}`);
  }
}
