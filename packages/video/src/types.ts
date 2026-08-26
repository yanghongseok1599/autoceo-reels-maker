export interface SubtitleWord { word: string; start: number; end: number }
export interface SubtitleSegment {
  id: number; text: string; start: number; end: number; words: SubtitleWord[];
}
export type SubtitleJSON = SubtitleSegment[];

export interface TitleCardScene {
  type: 'title_card';
  startTime: number;
  endTime: number;
  title: string;
  subtitle?: string;
  colorAccent?: string;
  /** 이 씬에만 적용할 배경. 없으면 ReelProps.backgroundImageUrl을 쓴다 */
  backgroundImageUrl?: string;
}
export type SceneDirective = TitleCardScene;

export interface Palette {
  accent: string;
  ink: string;
  paper: string;
}

export interface ReelProps {
  subtitles: SubtitleJSON;
  /**
   * 절대 http(s) URL이거나, Remotion public 루트 기준 상대 경로(예: `generated-audio/ab.mp3`).
   * 절대 파일시스템 경로는 렌더러가 받지 못한다 — `utils/audioSrc.ts` 참고.
   */
  audioUrl: string | null;
  scenes: SceneDirective[];
  durationInSeconds: number;
  /** StyleSheet.palette. 컴포넌트는 색을 직접 정하지 않는다 */
  palette: Palette;
  /** 스타일 시트 배경 라이브러리에서 고른 이미지. AI 생성 질감을 코드 모션 아래에 깐다 */
  backgroundImageUrl?: string;
  characterImageUrl?: string;
}

/**
 * 팔레트가 주어지지 않았을 때만 쓰는 최후 기본값. `lib/style-sheet.ts`의 `studio` 프리셋과
 * 같은 값이다 — video 패키지는 독립 실행되므로 lib에서 import할 수 없어 여기 한 번 적는다.
 * 색 리터럴이 허용되는 파일은 이 파일뿐이다.
 */
export const FALLBACK_ACCENT = '#caff00';
export const FALLBACK_PALETTE: Palette = {
  accent: FALLBACK_ACCENT,
  ink: '#f4f4f0',
  paper: '#0d0f10',
};
