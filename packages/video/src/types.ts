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

export interface ReelProps {
  subtitles: SubtitleJSON;
  audioUrl: string | null;
  scenes: SceneDirective[];
  durationInSeconds: number;
  /** StyleSheet.palette.accent. 컴포넌트는 색을 직접 정하지 않는다 */
  accentColor: string;
  /** 스타일 시트 배경 라이브러리에서 고른 이미지. AI 생성 질감을 코드 모션 아래에 깐다 */
  backgroundImageUrl?: string;
  characterImageUrl?: string;
}

/** 팔레트가 주어지지 않았을 때만 쓰는 최후 기본값 */
export const FALLBACK_ACCENT = '#caff00';
