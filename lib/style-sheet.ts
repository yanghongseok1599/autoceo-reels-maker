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

/**
 * 소유자당 키 하나. 배열이 아니라 시트 객체 하나가 들어간다 — 한 사람에게 하나뿐이므로.
 *
 * 예전에는 모든 수강생의 시트가 `style-sheets` 배열 하나에 있었다. 그러면 저장이
 * 읽기-수정-쓰기가 되고, 두 수강생이 같은 순간에 저장하면 나중에 쓴 쪽이 앞선 쪽을 지웠다.
 * 키를 나누면 서로의 쓰기가 겹칠 자리 자체가 없다.
 */
const keyFor = (ownerId: string) => `style-sheets/${ownerId}`;

export async function getStyleSheet(ownerId: string): Promise<StyleSheet> {
  const found = await store.read<StyleSheet | null>(keyFor(ownerId), null);
  // 키가 이미 소유자를 나누지만 소유자 확인은 남긴다. 방어를 두 겹으로 둬야 나중에 키
  // 구조를 바꿀 때 경계가 조용히 열리지 않는다.
  if (found && found.ownerId === ownerId) return found;

  return {
    ownerId,
    styleSheetUrl: null,
    backgroundLibrary: [],
    ...STYLE_PRESETS[DEFAULT_PRESET],
  };
}

/** 자기 키에 통째로 쓴다. 남의 시트를 읽지도 다시 쓰지도 않으므로 지울 것이 없다. */
export async function saveStyleSheet(sheet: StyleSheet): Promise<StyleSheet> {
  await store.write(keyFor(sheet.ownerId), sheet);
  return sheet;
}

/** 씬마다 다른 배경이 나오도록 라이브러리를 순환한다. 비어 있으면 배경 없이 렌더된다 */
export function pickBackground(sheet: StyleSheet, sceneIndex: number): string | undefined {
  const lib = sheet.backgroundLibrary;
  if (!lib.length) return undefined;
  return lib[sceneIndex % lib.length];
}
