import { store } from './store';

export interface StyleSheet {
  ownerId: string;
  presetId: string;
  styleSheetUrl: string | null;
  palette: { accent: string; ink: string; paper: string };
  toneWords: string[];
  backgroundLibrary: string[];
}

type Preset = Pick<StyleSheet, 'presetId' | 'palette' | 'toneWords'>;

export const STYLE_PRESETS: Record<string, Preset> = {
  paper: {
    presetId: 'paper',
    palette: { accent: '#c8553d', ink: '#2b2118', paper: '#f2e8d5' },
    toneWords: ['종이 질감', '컷아웃 콜라주', '빈티지 에디토리얼', '따뜻한 미색'],
  },
  studio: {
    presetId: 'studio',
    palette: { accent: '#caff00', ink: '#f4f4f0', paper: '#0d0f10' },
    toneWords: ['어두운 스튜디오', '고대비', '네온 액센트', '미니멀'],
  },
  clinic: {
    presetId: 'clinic',
    palette: { accent: '#2f80ed', ink: '#12233b', paper: '#f7fafc' },
    toneWords: ['밝고 청결', '의료 정보', '신뢰감', '차분한 블루'],
  },
  gym: {
    presetId: 'gym',
    palette: { accent: '#ff6b2c', ink: '#141414', paper: '#ededed' },
    toneWords: ['역동적', '피트니스', '강한 그림자', '오렌지 액센트'],
  },
};

const DEFAULT_PRESET = 'studio';
const KEY = 'style-sheets';

export async function getStyleSheet(ownerId: string): Promise<StyleSheet> {
  const sheets = await store.read<StyleSheet[]>(KEY, []);
  const found = sheets.find((s) => s.ownerId === ownerId);
  if (found) return found;

  return {
    ownerId,
    styleSheetUrl: null,
    backgroundLibrary: [],
    ...STYLE_PRESETS[DEFAULT_PRESET],
  };
}

export async function saveStyleSheet(sheet: StyleSheet): Promise<StyleSheet> {
  const sheets = await store.read<StyleSheet[]>(KEY, []);
  await store.write(KEY, [sheet, ...sheets.filter((s) => s.ownerId !== sheet.ownerId)]);
  return sheet;
}

/** 씬마다 다른 배경이 나오도록 라이브러리를 순환한다. 비어 있으면 배경 없이 렌더된다 */
export function pickBackground(sheet: StyleSheet, sceneIndex: number): string | undefined {
  const lib = sheet.backgroundLibrary;
  if (!lib.length) return undefined;
  return lib[sceneIndex % lib.length];
}
