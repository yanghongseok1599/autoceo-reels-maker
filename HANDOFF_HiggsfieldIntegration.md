# 인계 — Higgsfield 영상 생성 연동

작성 2026-08-26 · 대상: 이 저장소에서 이어 작업할 사람/세션

> 한 줄: **영상 생성이 501로 막혀 있다. 그런데 작동하는 설정은 이미 파일럿으로 확정돼 있다.
> 그 설정을 코드에 넣는 것이 남은 일이다.**

---

## 0. 시작 전 확인

**작업 트리가 더럽다.** 커밋은 `Initial Reels maker app` 하나뿐이고 나머지는 전부 미커밋이다.

```
 M app/api/video/generate/route.ts   app/api/voicebox/*   lib/voicebox-*   lib/env.ts
 M lib/mock-jobs.ts   app/page.tsx   .env.example   .gitignore
?? app/api/learning/   app/api/voicebox/preview/   app/reels/
?? lib/fish-audio-client.ts   lib/fish-voice-store.ts   lib/higgsfield-workflow.ts
```

손대기 전에 `git status` → `git diff`로 현재 상태를 먼저 파악하고, 브랜치를 따고 시작할 것.

**필요 환경**
- Higgsfield MCP 연결 (Ultra 플랜 계정)
- 로컬 Voicebox 실행 (`127.0.0.1:17493`) — 목소리 클론 레퍼런스 확보용
- `.env.example` 참조. 단 `HEYGEN_API_KEY`는 아래 이유로 더 이상 필요 없다

---

## 1. 제품 정의 (PRD 요약)

**"내 얼굴, 내 목소리로 — 텍스트만 입력하면 릴스 완성"**

피트니스·의료 전문가가 촬영 없이 자기 아바타로 영상을 만드는 SaaS.
타겟은 피트니스 트레이너·물리치료사·헬스센터 운영자.

| 포맷 | 내용 |
|---|---|
| Format A | 사진 1장 + 목소리 샘플 → 아바타가 대본을 읽는 토킹 릴스 |
| Format D | 포즈 가이드 + 레퍼런스 → 운동 시연 영상 |

성공 지표는 **생성 성공률 95% / 평균 생성 3분 이내 / 1주 내 2회 재사용**.
도달·조회수 같은 콘텐츠 성과는 지표가 아니다 — 이 선은 의도적이며 지켜야 한다(§6 참조).

---

## 2. 코드 현황 — 무엇이 비어 있나

| 파일 | 상태 |
|---|---|
| `app/api/avatar/create/route.ts` | **막힘.** `HEYGEN_API_KEY` 없으면 mock, 있으면 **501** |
| `app/api/video/generate/route.ts` | **막힘.** 입력 검증만 있고 실제 생성 없음 |
| `lib/higgsfield-workflow.ts` | 프롬프트 **문자열 빌더만.** API 호출 없음. 구버전(모델 미지정·이중 레퍼런스 없음) |
| `lib/voicebox-client.ts` | 실동작. 로컬 Voicebox, qwen 1.7B |
| `lib/fish-audio-client.ts` | 실동작. 단 파일럿에서 **검증되지 않음** |
| `lib/learning-store.ts` | 실동작. `.local-data/learning-records.json` + good/bad 피드백 |
| `lib/mock-jobs.ts` | 인메모리 `Map`. 서버 재시작 시 소실 |

**HeyGen은 포기해도 된다.** 파일럿이 Higgsfield 단독으로 같은 결과를 냈다.

---

## 3. 파일럿 확정 설정 — 이대로 넣으면 된다

2026-08-26 검증 완료. 사용자가 결과물(`06_cut_FINAL_wide_framing.mp4`)을 채택했다.

```
1) 음성   generate_audio
          model: seed_audio
          voice_type: element
          voice_id: 3d4573ab-5289-47fd-a5da-3fccd217fc85   (클론 보이스)

2) 영상   generate_video
          model: seedance_2_5
          mode:  omni_reference
          medias:
            start_image      = 소스 사진
            image_references = 같은 사진      ← 이중 투입이 정체성 고정의 핵심
            audio_references = 1단계 TTS job_id
          aspect_ratio: 9:16
          resolution:   1080p
          duration:     TTS 길이에 맞춤

3) 30초 초과 대본은 컷 분할 후 ffmpeg concat
```

### 왜 이 조합인가 (측정 근거)

| 항목 | 결과 |
|---|---|
| 한국어 립싱크 | 붙는다 |
| 얼굴 드리프트 | `wan2_7`은 6초 안에서도 턱선·광대가 변함. `seedance_2_5 omni_reference`는 안정 |
| 소스 업스케일 | 2160x3824로 올려도 **드리프트 개선 없음.** 해상도가 아니라 모델 구조 문제 |
| 카메라 고정도 (배경 첫↔끝 SSIM) | seedance 0.9949 / wan2_7 0.9810 |
| FRAMING LOCK 프롬프트 | **효과 없음** (0.9949 → 0.9946) |

마지막 줄이 중요하다. **구도는 프롬프트로 못 잡는다. 소스 사진에서 잡아야 한다.**

### 소스 사진 전처리

생성 영상은 소스보다 피사체가 항상 조금 크게 잡힌다(고정 오프셋). 뒤로 물리려면:

```
outpaint_image  aspect_ratio="4:5"  ← 1패스만
→ ffmpeg 중앙 9:16 크롭
   예: 1856x2304 → crop=1296:2304:280:0
```

2패스는 과하게 작아지고 비용만 든다. 크롭은 공짜.
**이미 넓은 구도의 사진은 outpaint를 건너뛰는 분기가 필요하다.**

---

## 4. 작업 순서

### ① `video/generate`의 501을 Higgsfield로 교체 — 최우선

§3 설정을 그대로 구현. 이거 하나면 제품이 실제로 영상을 뱉기 시작한다.

### ② `avatar/create`의 의미를 바꾸기

HeyGen 아바타 생성이 아니라 **소스 사진 업로드 + 필요시 outpaint 넓히기**가 실제 할 일이다.
현재 검증 로직(JPG/PNG, 10MB 상한)은 그대로 살릴 수 있다.

### ③ `lib/higgsfield-workflow.ts` 갱신

- 네거티브 프롬프트는 **살릴 것**: `no text overlay / captions / subtitles / watermark / lower-third`
  (AI 영상에 텍스트를 굽지 않고 자막은 후처리로 넣는다는 원칙과 일치)
- 구도 고정 문구가 있다면 **뺄 것** — 측정상 무효로 확인됨
- 모델·이중 레퍼런스를 반영해 현행화

### ④ 음성 경로 정리 — 현재 3갈래다

```
Voicebox   = 클론 레퍼런스 확보 (1회)     ← 유지
Higgsfield = 매 영상 TTS      (반복)      ← 정본
Fish Audio = 파일럿 미검증               ← 유지 이유를 정하거나 정리
```

> **금지**: chatterbox TTS 출력물을 클론 레퍼런스로 쓰면 클론의 클론이 된다.
> 클론 입력은 사람이 실제로 녹음한 원본이어야 한다(파일럿은 24.4초 / 무음 0 / mean -20.3dB 사용).

### ⑤ `mock-jobs.ts`를 영속 저장으로

인메모리라 서버 재시작 시 진행 중 잡이 사라진다. Higgsfield 잡은 수십 초~분 단위라
실연동하면 바로 문제가 된다. `learning-store.ts`가 이미 파일 저장을 하니 같은 방식으로.

### ⑥ 동봉 스킬 정정

`public/higgsfield-content-factory.skill` 안의 립싱크 모델 목록이 부정확하다.
Wan 2.7은 드리프트 최하위, Kling 3.0은 자체 오디오만 쓴다. 정답인
**Seedance 2.5 omni_reference가 목록에 없다**(2.0만 있음).
제품에 동봉되는 스킬이라 틀린 채로 두면 사용자가 잘못 따라간다.

---

## 5. 함정 (파일럿에서 실제로 밟은 것들)

- **preset 추천이 오면 거절할 것.** `generate_video`가 preset을 제안하면 `declined_preset_id`로
  재시도한다. `higgsfield_preset` 모델은 preset_id + 이미지 1장만 받아 `audio_references`를 못 넣는다
- **`kling3_0` / `dubbing`은 자체 TTS만 쓴다.** 클론 목소리가 안 들어간다
- **`audio_references` 수용 모델**: `wan2_7`, `seedance_2_5`(omni_reference), `grok_video_v15`
- **presigned URL의 Content-Type이 서명에 포함된다.** wav를 올려도 서버가 `audio/mpeg`로 정하면
  그 MIME에 맞춰 변환 후 전송해야 200이 뜬다. 서버 라우트에서 재현할 때 그대로 걸린다
- **업로드에 위젯은 필요 없다.** 로컬 파일이면
  `media_upload` → presigned URL에 `curl -X PUT` → `media_confirm`
- **의상·배경이 다른 사진을 한 편에서 섞으면** "다른 날 찍은 클립" 느낌이 난다. 한 벌로 통일할 것

---

## 6. learning-store의 과신 — 고쳐야 할 것

`getLearningInsights()`가 **good 1건만 있어도** "이 조합을 추천합니다"를 반환한다.
n=1에서 처방을 내보내는 구조다.

참고할 반례가 있다. 같은 브랜드의 SNS 파이프라인에서:

| 시도 | 표본 | 결과 |
|---|---|---|
| 표면 특징 10개 | n=248 | 9개가 성과를 **구분 못 함** |
| 서사 유형 7개 | n=44 | **전부** 신뢰구간 겹침 |

수백 건으로도 "무엇이 반응을 얻는가"에 답이 안 나왔다.

**권장**
- `signals`(관측 사실 나열)는 그대로 둔다
- `recommendation`(처방)은 표본 문턱을 넘을 때만 내보낸다. 그전에는 "아직 판단할 표본이
  부족합니다"가 정직하다
- 이 학습은 **생성 품질**(얼굴 안정성·립싱크·구도)에 한정한다.
  **콘텐츠 성과**(도달·반응)를 약속하는 쪽으로 넘어가면 근거가 없다

PRD 지표가 생성 성공률·시간·재사용률인 것은 잘 잡은 선이다. 그 선을 지킬 것.

---

## 7. 자산 ID

| 용도 | ID |
|---|---|
| 클론 보이스 (element) | `3d4573ab-5289-47fd-a5da-3fccd217fc85` |
| **넓힌 9:16 소스 (권장)** | `ea91f0cd-bfa2-4a05-8fdd-92dd34e60907` |
| 소스 사진 원본 | `4fd14c65-7562-4979-872f-185e7190cf4d` |
| 소스 업스케일 2K (무효했던 시도) | `8ec80efd-ed84-4598-b319-07d7491bcc7a` |
| 나레이션 TTS 잡 (5.77초) | `f0aa7f8a-99bd-441f-92ba-07be72125ba2` |
| `autoceo` character element | `aaec79bb-c47e-4c86-a00d-8f27ea7eece2` (§8 참조) |

**비용 기준선**: 6초 컷 1개 ≈ **55 크레딧**. 파일럿 전체 236.4 크레딧.
제품 가격 설계 시 원가의 출발점이다.

원본 사진 4장: `~/seok/릴스 프로필/`
- `1.jpeg` (847x1505, 9:16) 검정 폴로 — 파일럿에 사용
- `2.jpeg`, `3.jpeg` (847x1505, 9:16) — **이미 넓은 구도**, outpaint 불필요
- `4.png` (1080x1350, 4:5) 흰 셔츠 밝은 배경 — 9:16용은 위아래 outpaint 1패스 필요

---

## 8. 별건 — `autoceo` character Element

병렬 세션에서 릴스 프로필 4장으로 생성된 character element.

**이 제품의 토킹포토 경로에는 불필요하다.** §3이 Element가 아니라
`start_image` + `image_references` 이중 투입으로 정체성을 잡기 때문이다.

Element가 유효한 경우는 다르다 — **촬영본이 없는 새 장면**을 만들 때
(Nano Banana Pro, Seedream, Cinema Studio 등에서 이 인물을 등장시키기).

단 지금 그대로 쓰면 4장의 옷·배경이 달라 §5의 "다른 날 찍은 클립" 문제가 재현된다.
쓰려면 의상별로 나누는 편이 낫다.

---

## 9. 파일럿 산출물 위치

`.local-data/higgsfield-pilot/` — **`.gitignore`에 걸려 있어 이 저장소로 전달되지 않는다.**
다른 머신에서 이어받으려면 별도로 복사할 것.

담긴 것: 검증 컷 6종(`02`~`06`), 소스 사진 원본/업스케일/outpaint/최종, 비교 이미지 4종,
클론 레퍼런스 mp3, 나레이션 wav, 그리고 상세 기록인 `README.md`와 `INTEGRATION.md`.

기준점은 `06_cut_FINAL_wide_framing.mp4`다. 새 설정을 시도했다면 이것과 비교할 것.

---

## 10. 다음 단계 (파일럿 README의 제안)

대본이 정해지면:
```
대본 분할 → generate_audio_batch → generate_video_batch (최대 12개 동시)
→ ffmpeg concat → 필요시 자막 워크플로로 굽기
```
