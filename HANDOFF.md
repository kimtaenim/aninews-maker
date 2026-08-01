# aninews-maker — 이식용 핸드오프 (연애 클리셰 / ani-cliché)

> 새 세션에 이 파일 내용을 그대로 붙여넣고 시작하세요. 이전 대화 컨텍스트 없이도 이어서 작업할 수 있게 정리했습니다.

## 0. 필수 규칙 (반드시 지킬 것)
- **한국어로 대화.** 전문적 톤 유지 — 절대 욕설 금지, 사용자가 화나서 욕해도 따라하거나 되받지 말 것.
- **"물어가면서 해야지"** — 큰 기능은 무턱대고 만들지 말고 설계를 먼저 제안하고 확인받은 뒤 구현.
- 기존 기능을 임의로 빼지 말 것. 회귀 방지: 리팩터 후엔 의존 지점 전부 grep 후 전체 흐름 추적.
- 검증 안 하고 "진짜 원인 찾았다" 확정 선언 금지 — 검증 전엔 "가설"이라 말할 것.
- **작업 절차(매 변경마다):** 구현 → `npx tsc --noEmit` (+ 워커 파일 만졌으면 `node --check worker/*.mjs`) → 커밋 → `git push origin main` → SHA 보고. (로컬 `npm run build`는 Google Fonts 네트워크 때문에 실패하니 tsc로 게이트.)

## 1. 프로젝트 개요
- **aninews-maker**: 한국어 숏폼 영상 생성 앱. Next.js(App Router)/Vercel 프론트 + **Render Background Worker**(ffmpeg 합성, `worker/*.mjs`). 큐=Redis, 저장=Vercel Blob.
- 이미지=OpenAI gpt-image, 영상(i2v)=fal/Grok/Kling — **사용자 주력은 Grok(xAI)**(클리셰 새 프로젝트 기본값도 grok, f8510ab), TTS=ElevenLabs/Typecast, 텍스트=Anthropic Claude.
- **중요 제약: Vercel Node 라우트엔 ffmpeg 없음.** 오디오 "겹쳐 믹싱"·영상 합성은 **워커에서만** 가능. 웹서버에선 mp3 단순 이어붙이기(Buffer.concat)만 가능.
- 위치: `C:\myapps\aninews-maker21`. 형제 프로젝트 re-animator(`C:\myapps\re-animator`)와 개념 공유하나 별개 저장소.
- 파이프라인 8단계: source→script→keyframe→images→videos→voiceover→compose→subtitle (`lib/types.ts` STEP_ORDER).

## 2. ani-cliché(연애 클리셰) 모드 — 이미 구축된 것
`Project.mode: "news" | "cliche"`. cliché는 같은 파이프라인에 로맨스 프리셋을 씌운 것.
- 새 프로젝트: `app/cliche/new/` (트로프 칩 + 인물 행[이름+아키타입] + 스타일 토글) → `app/api/cliche/new/route.ts`.
- 대사 모델: `Scene.lines: SceneLine[]`(줄마다 text/speaker/emotion/audioUrl). 줄별 더빙 후 이어붙임.
  - **화자 상속 캐스케이드**: 빈 speaker는 바로 위 화자를 따라감. (Studio 줄편집 + audio/scene 라우트 양쪽)
  - 목소리 우선순위: `scene.voiceId → project.castVoices[speaker] → project.voiceId → env 기본`.
- 감정 연기: `lib/emotions.ts` 프리셋 → ElevenLabs `eleven_v3` + `[tag]` 프리픽스(감정 지정 시만).
- 출연진 패널: 이름+목소리+미리듣기 통합(Studio). cast 비면 씬 speaker에서 파생. 이름변경=`app/api/project/cast/route.ts`(cast+castVoices+씬 speaker 동기화).
- 카메라: 씬별 `motionScale`("large"→mode=cliche면 "cliche" 프리셋, "subtle"은 유지). `config/prompts.json` `video_motion.cliche`.
- 자막: 화려/장식 프리셋(`lib/captionPresets.ts` + `worker/caption-presets.mjs` 동기화, 렌더=`worker/subtitle-image.mjs`). 번들 폰트 `worker/fonts/*.ttf`.
- 효과음(SFX): 설명→생성(`app/api/audio/sfx/route.ts`, 한글이면 Haiku로 영어 번역)→Blob→`scene.sfxUrl`. 합성 때 목소리 밑에 amix(`worker/compose.mjs`). 최근 커밋 432da46이 amix normalize 호환 수정.

## 3. 지금 열려 있는 작업 (우선순위 순)

### ★ 1순위: "캐스팅 먼저" — ✅ 구현됨 (2610277, 배포 후 실사용 검증 대기)
사용자 확정 설계: **새 프로젝트 폼 2화면 위저드**(①클리셰·인물 → ②캐스팅) / 차단+건너뛰기 /
포트레이트 참조는 **키프레임+모든 씬** 주입 / 포트레이트 **1장+다시 생성**.
- 데이터: `Project.castMembers`(CastMember[]) 신설, cast/castVoices 는 파생 미러(더빙·워커 무변경).
- API: `POST /api/cast/portrait` 무상태(위저드용, `casting/<draftId>/` Blob 경로). 업로드 얼굴은 항상 웹툰 변환(딥페이크 방지).
- rename 이 `lines[].speaker`·`castMembers[].name` 도 동기화하게 보강.
- **남은 것**: ⑴ Vercel 배포 후 위저드 실사용 검증(업로드→변환, 생성, 미리듣기, 확정 생성) ⑵ Studio 내 캐스팅 재편집 UI(포트레이트 교체) — 지금 Studio 출연진 패널은 이름·목소리만 ⑶ 프로젝트 삭제 시 `casting/<draftId>/` Blob 고아 정리(사소).

### ★ 2순위: 효과음 버그 2건
- **(A) 최종 영상에 효과음 없음 — ✅ 해결 확인(2026-07-13).** amix 호환 수정(432da46)이 워커에 배포됐고 사용자가 "빗소리 합성된다" 확인. 워커는 Render **push 자동 배포 작동 중**(수동 배포 불필요) — 배포 검증은 Redis `worker:build`(빌드 표식)·`worker:heartbeat`(1분 갱신)로 원격 확인 가능(8fb7830).
- **(B) 새로고침하면 sfx가 있다 없다 함(경합) — ✅ 수정됨 (0985f75).** 검증 결과 scene/source 는 창이 ms 라 무관. 진짜 범인: **긴 생성 호출 뒤 낡은 스냅샷 통째 저장** 라우트들 — video/scene POST(제출 수 초)·GET 실패 경로, image/scene 에러 경로, image/keyframe, script/image-prompts·motions, stepchat(Claude 수십 초). 전부 "저장 직전 최신 재읽기 + 해당 필드만 머지"로 통일. 배포 후 재발 여부 관찰.

### ✅ 이번에 추가 구현 (8d9fccc, 배포 후 확인 대기)
- **MV 카메라 기본화** — "뮤직비디오 느낌 안 남" 원인: 씬별 움직임 크기 기본이 잔잔(스톱모션 톤). 클리셰 모드는 기본 '크게'(video_motion.cliche)로 + 모션 재생성도 cliche 분기(크래시줌·스피드램프 등). **기존 프로젝트는 영상 리롤해야 반영.**
- **Grok MV v2 튜닝 (0be514a, 사용자 "그록 밋밋" 피드백)** — 정지 앵커("Camera only/subject barely moves") 전면 제거 + 시작→끝 프레이밍 변화 명시 + 피사체 움직임 허용 + NEVER timid. 가이드·카메라 프리셋 10종·모션 생성·스크립트 지시 4개 층위 일관 교체. **검증되면 re-animator 에 같은 기조 이식하기로 함.** 테스트: 모션 재생성(또는 카메라 프리셋 재선택) 후 영상 리롤 — 씬에 저장된 옛 모션 문구 그대로 리롤하면 반쪽 테스트임.
- **클리셰 전용 '잔잔' 분리 (68af8b6)** — 클리셰에서 잔잔 선택 시 뉴스용 스톱모션 문구 대신 `video_motion.cliche_calm`(차분하되 글로시한 감성 드리프트) 적용. 씬 셀렉트 라벨도 "잔잔(감성 드리프트)/크게(MV·기본)"로.
- **분위기 씬(scene.mood)** — 대사·더빙·자막 없는 감성 인서트. 스크립트 생성이 1~2개 자동 포함 가능, 편집기에 "💫 분위기 씬 추가" 버튼. 자막 생략 워커 코드도 배포 확인됨(cliche-v12).
- **Studio 포트레이트 재편집** — 출연진 패널 🎨 얼굴(설명 생성/사진→웹툰). project/cast member 패치.
- **감정 확충** — 화남·고함·오열 등 11종 추가, 스크립트 프롬프트 감정 목록은 EMOTIONS 파생. 감정 태그는 **ElevenLabs 전용**(Typecast 미지원) — UI에 명시 + Typecast 목소리로 더빙될 줄/씬은 감정 UI 잠금(abd0e17). 엔진은 목소리 id(tc_ 프리픽스)로 판별 — 인물별 혼용 가능(d15b6b5), **목소리 목록은 두 엔진 전부 노출(임의 필터 금지 — 킬리언 누락 사고)**.
- **위저드 자동 임시저장 (31dc928)** — 캐스팅 위저드 상태(포트레이트 포함)를 localStorage 에 계속 저장, 새로고침해도 복원. 생성 성공 시 초안 비움. ("얼굴 생성했는데 날아감" 사고 재발 방지.)
- **ElevenLabs 목소리 개선 (31dc928)** — /api/tts/voices 가 계정 라이브러리(premade 제외)를 자동 노출: ElevenLabs 웹에서 Voice Library→추가만 하면 앱에 뜸. 커뮤니티 한국어 인기 보이스 8종(혁·도현·장호·태형/안나·지수·애니·하나 — 배역 톤 라벨)을 계정에 추가해둠. 사용자가 직접 추가했던 Chloe Cha 도 이제 목록에 보임.

- **2단계 생성 분리 (cb45e46, 사용자 확정)** — 클리셰 스크립트 생성이 이미지 프롬프트·모션까지 한 번에 만들던 것을 뉴스처럼 분리: 2단계=대사·분위기 씬·길이만(빠름·리롤 가벼움), 프롬프트=3·4단계(`generateImagePrompts`에 cliche 분기 — 같은 두 주인공·과장 리액션·분위기 씬 정경), 카메라=5단계(기존 cliche 분기). 타임아웃 재발 방지 겸(8265300에서 maxDuration 도 상향: script 300, stepchat·prompts·motions 120). **클리셰도 이제 3단계에서 "프롬프트 생성" 버튼을 눌러야 키프레임 진행 가능(뉴스와 동일 UX).**

### ✅ 사용자(테스터) 불만 3건 수정 + 클린 합성 (54cbd31, 워커 cliche-v13 배포 확인 필요)
- 씬3·6 "보이스 안 됨" = 자동 삽입된 분위기 씬 → **일반 씬 ↔ 분위기 씬 전환 토글** 추가(더빙 카드 "🔊 일반 씬으로" / 줄 편집 "💫 분위기 씬으로").
- 씬4 "지운 대사 계속 나옴"+자막 싱크 = 대사 수정 후 낡은 audioUrl 잔존 → **줄이 바뀌면 audioUrl·ttsTimestamps 자동 무효화**(재더빙 필요 상태로).
- "보이스 연기 안 됨" = 그 인물 목소리가 Typecast(감정 미지원) — 감정 UI 잠금으로 이미 표시됨. ElevenLabs 목소리로 바꾸라고 안내.
- **"🎞️ 영상만 합성" 버튼** — 보이스·자막·효과음·워터마크 제외, 씬 길이는 음성 기준 유지(편집기 타이밍 일치). cleanVideoUrl 별도 저장 + kind=clean 다운로드.

### 기타 미결(사용자가 미룸)
- "최근 사용 목소리" 기능(제안: 최근 사용 그룹 + 사용 중 pin + 검색 + 즐겨찾기). 사용자 "고민 더" 상태.
- 성우 1~19 → 실제 이름 표시(라이브 fetch 보강, 배포 후 확인).
- **시뮬 제조기(연애 미니게임) — 설계안 제안됨, 사용자 결정 대기(2026-07-15).** 게임 코어 확정: 여러 상대와 대화하며 친밀도(0~100)를 올려 고백을 받아내거나, 플레이어가 먼저 고백해 수락받는 게임. 설계안: 상대=castMembers 재사용(아키타입→Claude 페르소나), 매 턴 {reply, affinityDelta} JSON 판정, 마일스톤(25/50/75)에서 클리셰 영상 컷씬, 고백/거절 엔딩. Redis simgame/simplay + /api/sim/chat. 대기 중 결정 4개: ①위치(aninews 탭 추천) ②대화 모델(Haiku 추천) ③컷씬(기존 프로젝트 연결 추천) ④대화 TTS(텍스트만 추천). 투자 유치 언급 있었음.

## 4. 주요 파일 지도
- `lib/types.ts` — Project/Scene/SceneLine. mode, cast, castVoices, voiceId, scene.lines/speaker/emotion/voiceId/sfx/sfxUrl/sfxVolume.
- `lib/scenes.ts` `parseClicheScenes`, `lib/script.ts` `generateClicheScript`, `lib/emotions.ts`, `lib/elevenlabs.ts`(`synthesizeSpeech`+emotion, `generateSoundEffect`), `lib/captionPresets.ts`.
- `app/api/audio/scene/route.ts` — 줄별 더빙 + 화자 캐스케이드 + mp3 concat.
- `app/api/audio/sfx/route.ts` — 효과음 생성(영어 번역).
- `app/api/scene/source/route.ts` — 씬 패치(captionStyle/emotion/speaker/voiceId/lines/sfx/sfxUrl/sfxVolume). ← (B) 경합 손볼 곳.
- `app/api/project/voice`·`project/cast`·`tts/voices`·`tts/preview`·`cliche/new`·`video/scene` 라우트.
- `app/project/[id]/Studio.tsx` — 큰 파일. cliché 줄편집/출연진/SFX UI/감정칩/카메라. (읽을 때 부분 읽기.)
- `app/cliche/new/ClicheNewForm.tsx`, `components/Header.tsx`(새 영상·라이브러리·💘 연애 클리셰), `app/layout.tsx`(장식 폰트 next/font).
- `worker/compose.mjs`(합성+SFX amix), `worker/subtitle-image.mjs`, `worker/caption-presets.mjs`, `worker/captions.mjs`, `worker/fonts/`.
- `config/style-profiles.json`(realistic, webtoon-romance), `config/prompts.json`(script_cliche, video_motion.cliche), `config/voices.json`.

## 5. 최근 커밋(신→구)
54cbd31 불만3건+클린합성 · d644062 라이브러리 페이지네이션 · cb45e46 2단계 분리 · 8265300 타임아웃 · 31dc928 위저드 임시저장+EL 라이브러리 · abd0e17 감정 EL 전용 잠금 · d15b6b5 Typecast 복원 · 68af8b6 cliche_calm · 0be514a MV v2 · f8510ab 기본 grok · 8fb7830 워커 표식 · 8d9fccc MV+분위기씬+포트레이트+감정 · 2610277 캐스팅 위저드 · 0985f75 저장 경합 · 432da46 sfx amix.

## 6. 새 세션 시작 안내
이 문서는 **배경·이력 상세**용. 실제 작업 착수는 목적에 맞는 자매 문서로:
- **개선·검증 작업** → `HANDOFF-improve.md` (배포 검증 대기 목록, 컨벤션, 미착수 작업)
- **시뮬 제조기(연애 미니게임)** → `HANDOFF-simgame.md` (설계안·대기 중 결정 4개·비용 결론)
