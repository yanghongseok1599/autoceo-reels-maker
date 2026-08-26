# 통합 영상 스튜디오 — 설계 스펙

작성 2026-08-26 · 대상 저장소 `Reels maker` · 상태: 검토 대기

> 한 줄: **하나의 사이트에서 여러 생성 엔진으로 영상을 만든다. 1단계는 Remotion 세로 릴스만 구현하되, 엔진을 갈아끼울 수 있는 구조로 짓는다.**

---

## 1. 배경

`Reels maker`는 "내 얼굴, 내 목소리로 텍스트만 입력하면 릴스 완성"을 목표로 시작했고, HeyGen 연동을 전제로 설계됐다. 그러나 실제 코드에서 HeyGen 경로는 전부 막혀 있다 — API 키가 없으면 mock을 반환하고, 있으면 `501`을 반환한다. 즉 **키를 넣으면 오히려 앱이 멈춘다.**

한편 2026-08-26 파일럿(`.local-data/higgsfield-pilot/`)에서 Higgsfield 단독으로 동일한 결과(사진 1장 + 클론 목소리 립싱크)를 내는 설정이 확정됐다. HeyGen은 필요 없다.

동시에 두 개의 인접 프로젝트가 확인됐다.

| 프로젝트 | 내용 | 생성 원가 |
|---|---|---|
| `youtube-voice-long-main` | Remotion 기반 모션그래픽 엔진. 씬 16종, 캐릭터 슬롯, 음성 반응 연출 | 렌더 컴퓨팅만 |
| `longtube_pen/srt-sketch-video` | 화이트보드 펜 드로잉 스튜디오. 캔버스 + ffmpeg | 렌더 컴퓨팅만 |

Higgsfield 경로는 30초 릴스 1편당 약 196 크레딧(약 1.2만원)이 든다. Remotion 경로는 생성 크레딧이 0이다. **두 경로를 한 제품 안에 두면 대부분의 영상을 무료 경로로 처리하고, 립싱크가 꼭 필요한 것만 유료 경로로 보낼 수 있다.** 이것이 이 설계의 핵심 동기다.

---

## 2. 확정된 결정

| # | 결정 | 근거 |
|---|---|---|
| D-1 | HeyGen 완전 제거 | 파일럿이 Higgsfield 단독으로 동일 결과를 냄 |
| D-2 | 뼈대는 `Reels maker`, Remotion은 패키지로 이식 | `Reels maker`는 동작이 확인됨. `youtube-voice-long-main`은 `node_modules`조차 없는 미검증 코드 |
| D-3 | 렌더 워커는 맥에서 시작, 풀(pull) 방식 | 인바운드 포트 개방 불필요. VPS 이전 시 코드 변경 없음 |
| D-4 | 1단계는 Remotion 엔진만 구현 | 원가 0, 결제·BYOK 없이 출시 가능 |
| D-5 | 캐릭터는 Rive에 투자 | 리그 하나로 상태 무한 파생. `@remotion/rive` 공식 지원 |
| D-6 | Higgsfield는 3단계, BYOK | 편당 1.2만원을 운영자가 떠안으면 적자. 수강생이 자기 계정 연결 |
| D-7 | Higgsfield 릴스 길이는 30초 | 단일 생성 상한이 30초. 컷 분할·concat 불필요 |
| D-8 | 1단계에 최소 운영 포함 | 수강생이 실제로 써야 무엇을 고칠지 알 수 있음 |

---

## 3. 범위

### 1단계에 포함

- Remotion 엔진으로 9:16 세로 릴스 생성
- **스타일 시트와 배경 라이브러리** (운영자 프리셋 3~4종 + 온보딩 1회 생성)
- 대본 → TTS → 단어 타이밍 → 씬 지시서 → 배경 선택 → 렌더 파이프라인
- 세로 씬 컴포넌트 6종
- Rive 캐릭터 1체 (PNG 폴백 포함)
- 풀 방식 렌더 워커 (맥)
- 엔진 인터페이스 (3개 엔진 수용, 1개만 구현)
- Vercel 배포 + 초대코드 인증
- 수강생별 결과물 분리
- 기존 기술부채 정리 (§11)

### 1단계에서 제외

- Higgsfield 엔진 (3단계)
- 화이트보드 엔진 (4단계)
- 자동 결제 — 초기에는 계좌이체 수동 처리
- 회원가입·비밀번호 재설정 — 초대코드로 대체
- 씬 나머지 10종
- 16:9 롱폼

---

## 4. 아키텍처

```
┌─ Next.js 앱 (Vercel) ──────────┐      ┌─ 렌더 워커 (맥, 상시가동) ────┐
│  UI  (기존 globals.css 재사용)  │      │  1. 대기 잡 폴링              │
│  /api/auth      초대코드        │      │  2. Remotion 번들 + 렌더      │
│  /api/projects  프로젝트 CRUD   │◀────▶│  3. Rive/Lottie 에셋 로드     │
│  /api/jobs/next 잡 배출         │ 폴링 │  4. whisper 로컬 STT          │
│  /api/jobs/:id  진행률·결과 수신 │      │  5. 결과 업로드               │
└────────────────────────────────┘      └──────────────────────────────┘
                │
                └─ Blob 저장소 (결과 MP4 · 소스 에셋)
```

**풀 방식을 쓰는 이유**: 워커가 앱을 호출하는 방향이므로 맥이 외부에 포트를 열 필요가 없다. 방화벽·터널링 설정이 사라지고, 워커를 VPS로 옮길 때도 앱 코드는 그대로다.

**워커 인증**: 워커는 공유 시크릿(`WORKER_TOKEN`)으로 `/api/jobs/*`에 접근한다. 이 토큰은 서버 환경변수와 워커 설정에만 존재하며 클라이언트 번들에 포함되지 않는다.

**렌더가 Next.js 안에서 돌 수 없는 이유**: `@remotion/renderer`는 헤드리스 Chrome을 실행하고 ffmpeg를 호출한다. 서버리스 함수의 실행시간·바이너리 크기 제약을 넘는다.

---

## 5. 엔진 인터페이스

"한 사이트에서 다 제작"의 구현 형태다. 엔진마다 입력 형태와 비용 모델이 다르지만, 앱과 UI는 이 인터페이스만 안다.

```ts
type EngineId = 'remotion' | 'higgsfield' | 'whiteboard'

interface EngineCapabilities {
  aspectRatios: string[]      // ['9:16'] | ['9:16','16:9']
  maxDurationSec: number
  lipSync: boolean
  costModel: 'compute' | 'credits'
  requiresUserKey: boolean    // BYOK 여부
}

interface VideoEngine {
  id: EngineId
  capabilities: EngineCapabilities
  prepare(input: ProjectInput): Promise<EnginePlan>
  submit(plan: EnginePlan, ctx: EngineContext): Promise<EngineJobRef>
  poll(ref: EngineJobRef, ctx: EngineContext): Promise<EngineStatus>
}
```

`EngineContext`는 사용자별 자격증명(3단계의 Higgsfield API 키)을 담는다. 1단계에서는 비어 있다.

1단계에서 `remotion`만 구현하고 나머지 둘은 인터페이스만 선언한다. 3단계에서 Higgsfield를 붙일 때 UI·파이프라인·데이터 모델은 건드리지 않고 어댑터만 추가한다.

---

## 6. 파이프라인

파이프라인은 두 갈래다. **온보딩은 수강생당 1회**, 제작은 영상마다 돈다.

```
[온보딩 · 수강생당 1회]
  레퍼런스 이미지 → 스타일 시트 생성 → 배경 라이브러리 12장 생성 → 저장

[제작 · 영상마다]
  대본 입력
    → ① TTS (음성 생성)
    → ② STT (단어 단위 타임스탬프 추출)
    → ③ 씬 지시서 생성 (스타일 시트 참조)
    → ④ 배경 선택 (라이브러리에서 · 기본값)
    → ⑤ 엔진 렌더
    → ⑥ 결과 저장 + 학습 기록
```

### ⓪ 스타일 시트 — 온보딩에서 1회

두 개의 독립적인 제작 사례가 같은 결론에 도달했다. 하나는 디자인 시스템을 `design.md`로
만들어 프로젝트가 참조하게 했고, 다른 하나는 스타일 시트 이미지를 먼저 만들어 모든 장면의
기준으로 삼았다. 이유도 같다 — **전역 기준이 없으면 장면마다 분위기가 흩어진다.**

수강생별로 다음을 저장한다:

```ts
interface StyleSheet {
  ownerId: string;
  referenceImageUrls: string[];   // 수강생이 고른 레퍼런스 (또는 운영자 프리셋)
  styleSheetUrl: string;          // 생성된 기준 이미지
  palette: { accent: string; ink: string; paper: string };
  toneWords: string[];            // 씬 지시서 생성 프롬프트에 주입
  backgroundLibrary: string[];    // 이 스타일로 생성해둔 배경 12장
}
```

`palette.accent`는 씬 컴포넌트의 `colorAccent` 기본값이 된다. 하드코딩된 `#caff00`을 대체한다.

**운영자 프리셋을 3~4종 미리 만들어 둔다.** 수강생 20명 규모에서 각자 레퍼런스를 고르게
하는 것보다 프리셋을 고르게 하는 편이 온보딩이 짧고 품질 편차도 작다. 직접 고르는 경로는
남겨두되 기본값은 프리셋이다.

### ⓪-2 배경 라이브러리 — 비용 때문에 이렇게 한다

씬마다 배경 이미지를 새로 생성하면 편당 약 12 크레딧이 든다. 편수가 늘면 이게 운영자
부담으로 쌓인다(20명 × 25편 = 월 6,000 크레딧, Ultra 2계정 분량).

그래서 **온보딩에서 배경 12장을 미리 생성해두고 씬마다 재사용한다.** 수강생당 1회
26 크레딧(스타일 시트 2 + 배경 24)이면 끝나고, 이후 제작은 이미지 비용이 0이다.

수강생이 특정 씬에 새 배경을 원하면 그때만 2 크레딧을 쓴다. 기본값은 아니다.

### ① TTS

`lib/fish-audio-client.ts`를 사용한다. 이 저장소에서 **유일하게 실동작이 확인된 외부 연동**이다. 톤은 `temperature`(0.55~0.82), 말하기 속도는 `prosody.speed`(0.8~1.35)로 매핑되어 이미 구현돼 있다.

로컬 Voicebox(`127.0.0.1:17493`)는 배포 환경에서 접근이 불가능하므로 사용하지 않는다.

### ② STT — 이 파이프라인의 필수 조각

`voiceAnalysis.ts`가 캐릭터 글로우·자막 스케일·파티클을 구동하는 근거는 **단어 단위 타임스탬프**(`SubtitleWord { word, start, end }`)다. Fish Audio TTS는 mp3만 반환하므로, 생성된 음성에 STT를 다시 돌려 타이밍을 얻어야 한다.

**렌더 워커(맥)에서 `whisper.cpp`를 로컬 실행한다.** 워커가 이미 상시 가동 중이고, 로컬 실행이므로 API 비용이 0이다. 클라우드 STT(Gemini 등)는 워커를 VPS로 옮겨 CPU가 부족해질 때의 대안으로 남겨둔다.

### ③ 씬 지시서 생성

대본과 단어 타이밍을 입력받아 `SceneDirective[]` JSON을 생성한다. 스키마는 `youtube-voice-long-main/packages/shared/src/types.ts`의 정의를 그대로 가져오되, 1단계에서 구현하는 6종으로 제한한다.

LLM 호출은 서버사이드 전용이며, 실패 시 대본을 균등 분할한 기본 씬 배열로 폴백한다. 이 폴백은 선택이 아니라 필수다 — LLM 실패로 전체 파이프라인이 멈추면 안 된다.

### ④ 렌더

워커가 Remotion 번들을 만들고 `renderMedia()`를 호출한다. 번들은 워커 기동 시 1회 생성하고 캐시한다.

### ⑤ 결과

MP4를 Blob 저장소에 올리고, `learning-store.ts`에 기록한다.

---

## 7. 데이터 모델

기존 `lib/learning-store.ts`의 파일 저장 패턴을 확장한다. 20명 규모에서는 파일로 충분하며, 저장소 접근을 인터페이스 뒤에 두어 나중에 DB로 교체할 수 있게 한다.

```ts
interface StudentAccount {
  id: string
  inviteCode: string        // 해시 저장
  name: string
  createdAt: string
  monthlyRenderCount: number
}

interface Project {
  id: string
  ownerId: string           // StudentAccount.id
  engine: EngineId
  script: string
  audioUrl: string | null
  subtitles: SubtitleJSON | null
  scenes: SceneDirective[] | null
  resultUrl: string | null
  createdAt: string
}

interface RenderJob {
  id: string
  projectId: string
  engine: EngineId
  status: 'queued' | 'claimed' | 'rendering' | 'completed' | 'failed'
  progress: number          // 0~100
  claimedAt: string | null  // 스테일 잡 회수 판단용
  error: string | null
}
```

`lib/mock-jobs.ts`의 인메모리 `Map`을 이 `RenderJob` 영속 저장으로 대체한다. 현재 구조는 서버가 재시작되면 진행 중인 작업이 사라지며, 서버리스 배포에서는 요청마다 인스턴스가 달라 아예 동작하지 않는다.

**스테일 잡 회수**: `claimed` 상태로 일정 시간(기본 15분)이 지난 잡은 `queued`로 되돌린다. 워커가 죽어도 작업이 영구히 묶이지 않게 한다.

---

## 8. 세로 컴포지션

`youtube-voice-long-main`의 씬 컴포넌트는 전부 1920×1080이다. 1080×1920으로 재작업이 필요하다.

**1단계 구현 대상 6종**

| 씬 | 용도 |
|---|---|
| `title_card` | 훅 — 첫 3초 |
| `content_slide` | 핵심 내용 불릿 |
| `emphasis` | 키워드 강조 |
| `list_reveal` | 순서 있는 항목 |
| `quote` | 인용·강조 문장 |
| `conclusion` | 마무리·CTA |

나머지 10종(`code_editor`, `diagram_flow`, `timeline`, `infographic`, `comparison`, `number_counter`, `split_content`, `image_slide`, `full_text`, `transition`)은 피트니스 릴스에서 사용 빈도가 낮다. 필요해지면 추가한다.

재작업은 레이아웃 재배치이지 로직 재작성이 아니다. 애니메이션 타이밍과 `voiceAnalysis` 연동은 그대로 가져온다.

---

## 9. Rive 캐릭터

### 구성

- 퍼널띵 캐릭터를 Rive에서 벡터로 리깅하고 상태머신을 만든다
- 상태: `idle` · `thinking` · `pointing` · `surprised` · `talking`
- 씬 타입 → 캐릭터 상태 매핑 테이블을 코드에 둔다
- `@remotion/rive`로 컴포지션에 삽입한다

### 폴백이 먼저다

**리깅이 완료되기 전까지는 기존 상황별 PNG로 동작하게 만든다.** 캐릭터 렌더링을 인터페이스로 감싸고, `RiveCharacter`와 `PngCharacter` 두 구현을 둔다.

현재 보유 자산은 `longtube_pen/srt-sketch-video/assets/whiteboard/bsd-jazz-mvp/character-scenes/`의 PNG 5장이다:
`scene-01-thinking` · `scene-02-48h-magic` · `scene-03-prototype-point` · `scene-04-tool-groove` · `scene-05-restart-swing`

이 구조를 쓰면 리깅이 지연돼도 개발이 막히지 않는다. Rive가 준비되면 구현체만 교체한다.

> 참고: `scripts/build_funnelthing_character_sheet.py`가 참조하는 `assets/character/funnelthing/` 디렉터리는 현재 존재하지 않는다. 원본 레퍼런스와 표정 시트가 없어 이 스크립트는 지금 실행되지 않는다. Rive 리깅 전에 원본 확보가 선행되어야 한다.

---

## 10. 운영

### 인증

초대코드 방식. 운영자가 코드를 발급하고 수강생이 최초 1회 입력하면 세션 쿠키가 발급된다. 회원가입·비밀번호·이메일 인증은 만들지 않는다. 20명 규모에서 그 비용은 정당화되지 않는다.

코드는 해시로 저장하고, 발급·회수는 운영자용 파일 또는 간단한 관리 화면으로 처리한다.

### 결제

1단계에서는 계좌이체 수동 처리. 실제 사용이 확인된 뒤 자동 결제를 붙인다.

### 사용량 제한

렌더 원가가 0은 아니다(맥 CPU와 시간). 계정별 월 렌더 횟수를 기록하고 상한을 둔다. 상한 초과 시 큐에 넣지 않고 안내한다.

### 렌더 워커 운영

맥을 켜두고 워커 프로세스를 상시 실행한다. 워커가 죽으면 잡이 `queued`에 쌓이고, 재기동 시 자동으로 처리된다. 워커 상태(마지막 폴링 시각)를 관리 화면에 노출해 죽은 걸 모르고 방치하는 상황을 막는다.

---

## 11. 정리 대상

| 대상 | 조치 | 이유 |
|---|---|---|
| `app/api/avatar/create` · `voice/clone` · `video/generate`의 HeyGen 분기 | 제거 | 키가 있으면 501을 반환하는 역설적 구조 |
| `lib/voicebox-client.ts` (402줄) | 삭제 | 어디에서도 import되지 않는 죽은 코드 |
| `app/reels/` (941줄) | 삭제 | `app/page.tsx`의 구버전 복제본. 라우트가 살아 있어 접속 시 옛 화면이 뜬다 |
| `lib/mock-jobs.ts` | `RenderJob` 영속 저장으로 대체 | §7 |
| `getLearningInsights()` | 표본 문턱 도입 | §12 |
| `public/higgsfield-content-factory.skill` | 립싱크 모델 목록 정정 | 3단계에 처리 |
| 미커밋 1,384줄 | 커밋 후 브랜치 분기 | 작업 시작 전 복구 지점 확보 |

---

## 12. learning-store의 과신 수정

`getLearningInsights()`는 good 피드백이 **1건만 있어도** "이 조합을 추천합니다"를 반환한다. n=1에서 처방을 내보내는 구조다.

**조치**

- `signals`(관측 사실 나열)는 그대로 둔다
- `recommendation`(처방)은 표본이 문턱을 넘을 때만 반환한다. 그 전에는 "아직 판단할 표본이 부족합니다"를 반환한다
- 학습 대상을 **생성 품질**(얼굴 안정성·립싱크·구도)에 한정한다. **콘텐츠 성과**(도달·조회수·반응)를 예측하는 쪽으로 확장하지 않는다

마지막 항목이 중요하다. PRD의 성공 지표가 생성 성공률·생성 시간·재사용률로 잡혀 있는 것은 의도적으로 그은 선이며, 이 선을 지킨다. 콘텐츠 성과 예측은 근거가 없다.

---

## 13. 원가 모델

### 1단계 (Remotion 경로)

| 항목 | 비용 |
|---|---|
| 영상 생성 크레딧 | **0원** (Remotion 렌더) |
| 이미지 크레딧 — 온보딩 | **수강생당 26 크레딧 ≈ 1,600원, 1회** (스타일시트 2 + 배경 12장 × 2) |
| 이미지 크레딧 — 제작 | **0원** (배경 라이브러리 재사용). 새 배경 요청 시에만 2 크레딧 ≈ 120원 |
| Remotion 라이선스 | **0원** (3인 이하 무료 티어. 상업적·무제한 사용 명시) |
| 렌더 | 맥 전기료 + 시간 |
| TTS (Fish Audio) | 사용량 과금 — **요금 확인 필요** |
| STT | 0원 (워커에서 whisper 로컬 실행) |
| Vercel | 무료 티어 예상 (렌더가 워커에 있으므로 부하 낮음) |

수강생 20명 온보딩 총액은 **520 크레딧 ≈ 32,000원 1회**다. 이후 제작량이 늘어도
이미지 비용은 늘지 않는다.

> **이 설계를 택한 이유**: 씬마다 배경을 새로 생성하면 편당 12 크레딧이고, 20명이 월 25편씩
> 만들면 **월 6,000 크레딧(Ultra 2계정, 약 37만원)**이 된다. 라이브러리 재사용으로
> 이 변동비를 1회성 고정비로 바꾼다. 실측 근거: 이미지 1장 2 크레딧, 영상 30초 195 크레딧
> (2026-08-26 `get_cost` 프리플라이트).

### 3단계 (Higgsfield 경로) — 참고

실측 기준(2026-08-26, `get_cost` 프리플라이트):

| 항목 | 값 |
|---|---|
| `seedance_2_5` duration 범위 | 4~30초 |
| 영상 비용 | 초당 6.5 크레딧 (6초=39, 30초=195) |
| TTS `seed_audio` 30초 대본 | 0.9 크레딧 |
| **30초 릴스 1편** | **약 196 크레딧** |
| Ultra 플랜 | $129/월 · 3,000 크레딧 · 이월 없음 |
| Ultra 1계정 월 생성량 | **30초 릴스 약 15편** |

BYOK이므로 이 비용은 수강생이 부담한다. 운영자 원가는 0이다.

---

## 14. 위험과 미검증 가정

| # | 항목 | 상태 | 대응 |
|---|---|---|---|
| R-1 | `youtube-voice-long-main`이 한 번도 실행된 적 없음 (`node_modules` 부재, 커밋 1개) | **미검증** | **1단계 첫 작업**으로 설치 후 렌더 1회 성공을 확인한다. 실패하면 씬 이식 범위를 재산정한다 |
| R-2 | Fish Audio 미설정 (`.env.local` 부재) | 확인됨 | `FISH_API_KEY` 발급 필요. 요금제도 함께 확인 |
| R-3 | Fish Audio TTS 요금 | 미확인 | 1단계 착수 시 확인. 무료 경로의 유일한 변동비다 |
| R-4 | Rive 리깅 공수 | 미산정 | 디자인 작업. PNG 폴백으로 개발과 분리했으므로 일정 위험은 격리됨 |
| R-5 | 30초 Higgsfield 생성에서 얼굴 유지 여부 | **미검증** | 파일럿은 **6초에서만** 안정성 측정(SSIM 0.9949). 3단계 착수 시 196크레딧으로 검증 컷 1개를 뽑아 `06_cut_FINAL_wide_framing.mp4`와 비교한다 |
| R-6 | Higgsfield REST API가 MCP와 동일한 기능·과금인지 | **미검증** | 3단계 착수 시 API 키 발급 후 확인. `omni_reference`·`audio_references` 지원과 구독 크레딧 차감 여부가 BYOK 모델의 전제다 |
| R-7 | Remotion 라이선스의 제3자 렌더 해석 | 낮음 | 무료 티어 게이트는 인원수이며 렌더 트리거 주체를 제한하는 조항은 문서에 없다. 유료 전환 전 확인 메일 권장 |

---

## 15. 프레임워크 이탈 조건

Remotion 대신 **HyperFrames**(Apache 2.0, 규모 무관 영구 무료)로 전환하는 조건을 미리 정의한다.

**전환 조건**: 조직이 4인 이상이 되어 Company License 대상이 될 때.

**전환 시 재작성 범위**: 씬 컴포넌트 6종 + 캐릭터 컴포넌트. React → HTML/GSAP. HyperFrames는 자체 문서에서 React 상태머신·서드파티 React UI 이식이 어렵다고 명시한다.

**전환의 걸림돌**: HyperFrames 문서에 **Rive 지원이 전혀 언급되지 않는다.** 전환 시 Rive를 직접 붙이거나(프레임 단위 결정론적 재생을 자체 구현) 캐릭터를 Lottie로 전환해야 한다. Lottie는 양쪽 모두 결정론적으로 지원한다.

**실사용 증언**: HyperFrames로 모션그래픽을 제작한 공개 사례(라이프3.0픽처스, 2026-05-29)에서
제작자가 두 가지 문제를 보고했다 — 브라우저 기반 렌더링이라 **에러가 자주 나고**,
**자바스크립트 기반 애니메이션이 렌더링 결과에 반영되지 않는 경우가 있다.** 우회책으로
전체화면 재생을 화면 녹화하는 방법까지 제시되어 있다(품질 열화 감수).

Rive는 WASM/캔버스 런타임이므로 정확히 이 실패 범주에 들어간다. **캐릭터를 Rive로 가는 한
HyperFrames 전환은 권장되지 않는다.** 전환이 필요해지면 캐릭터를 Lottie로 함께 전환하는
것을 전제로 재검토한다.

엔진 인터페이스(§5)와 렌더 워커 분리(§4) 덕분에 앱·API·데이터 모델은 전환의 영향을 받지 않는다.

---

## 16. 성공 기준

1단계 완료 조건:

- 수강생이 초대코드로 접속해 대본을 입력하면 9:16 MP4가 생성된다
- 캐릭터가 음성 타이밍에 반응한다
- 생성 실패 시 원인이 사용자에게 이해 가능한 문구로 표시된다
- 워커가 죽었다 살아나도 큐에 쌓인 작업이 처리된다
- 수강생 3명 이상이 각자 1편 이상을 실제로 만든다

측정 지표는 PRD를 따른다: 생성 성공률 95% 이상, 재사용률 1주 내 2회 이상.

---

## 17. 이후 단계

| 단계 | 내용 | 선행 조건 |
|---|---|---|
| 2단계 | 캐릭터 에셋 확장 — Rive 상태 추가, 씬별 연출 다양화 | 1단계 출시 후 실사용 피드백 |
| 3단계 | Higgsfield 엔진 (BYOK) — 립싱크 아바타 | R-5, R-6 검증 |
| 4단계 | 화이트보드 엔진 — 16:9 롱폼 | 릴스 경로 안정화 |

각 단계는 자체 스펙과 구현 계획을 갖는다.
