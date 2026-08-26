import path from 'node:path';

/**
 * Next 앱의 `public/` 디렉터리. 렌더 워커도 같은 저장소 루트에서 돌기 때문에 값이 같다.
 *
 * 나레이션 mp3, 완성 MP4, Remotion 번들의 public 루트가 **모두 이 한 곳**을 가리켜야 한다.
 * 셋 중 하나라도 다른 경로를 쓰면 렌더는 성공하는데 소리가 없거나, 파일은 생겼는데
 * 브라우저가 404를 받는 조용한 실패가 된다.
 */
export function appPublicDir(): string {
  return process.env.PUBLIC_DIR ?? path.join(process.cwd(), 'public');
}
