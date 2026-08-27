export interface Store {
  read<T>(key: string, fallback: T): Promise<T>;
  write<T>(key: string, value: T): Promise<void>;
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
