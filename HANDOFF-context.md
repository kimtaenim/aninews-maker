# 컨텍스트 이전 프롬프트 — aninews-maker21 (2026-08-01 기준)

> 새 대화창에 이 문서를 통째로 붙여넣고 시작. 이전 대화 없이 이어서 작업할 수 있게 정리했다.
> 이 문서가 최신본이다. `HANDOFF-longform-v2.md`(7/26)는 롱폼 상세의 보조 문서로만 참고.

---

## 0. 환경과 규칙 (먼저 읽을 것)

- `C:\myapps\aninews-maker21` — Next.js(App Router) + Upstash Redis(프로젝트 상태) + Vercel Blob(미디어) + Render 워커(ffmpeg 합성)
- 프로덕션: https://aninews-maker.vercel.app
- **먼저 읽기**: `C:\Users\kimta\.claude\projects\C--myapps-aninews-maker21\memory\MEMORY.md`
  특히 `aninews-principles-single-source`, `aninews-elongated`, `aninews-longform`, `aninews-worker-render-oom`, `deploy-gates`, `never-claim-cause-without-proof`, `no-unrequested-global-changes`, `use-korean-honorifics`, `professional-tone`

**대화 규칙**
- **한국어 존댓말.** 욕설 금지 — 사용자가 화나서 욕해도 따라하거나 되받지 말 것.
- **호칭 쓰지 말 것**('사장님' 등 — 반복 지적됨).
- **검증 전에 "원인 찾았다" 확정 금지.** 검증 전엔 "가설"이라고 말한다.
- **큰 기능은 설계 먼저 제안하고 확인받은 뒤 구현.**
- **안 시킨 기능을 임의로 빼거나 바꾸지 말 것.** 전역 기본값·config 도 마찬가지.

**작업 절차(매 변경)**
1. 구현 → 2. `npx tsc --noEmit` **종료코드 확인**(파이프로 삼키지 말 것) → 3. 워커 만졌으면 `node --check worker/*.mjs` + **실제 모듈 로드 테스트**(`node --check`는 임포트 불일치를 못 잡는다) → 4. `npm run build` → 5. 커밋 → 6. `git push origin main` → 7. **SHA 보고**

**지뢰**
- ⚠️ **`git add`에 디렉터리를 통째로 넣지 말 것.** 이 폴더는 여러 세션이 동시에 작업한다. 내가 `git add lib`로 다른 세션의 미완성 작업을 커밋에 쓸어담은 사고가 실제로 있었다(`f58a858`). **내가 만진 파일만 명시적으로 add.**
- ⚠️ 로컬에서 `worker/index.mjs` 띄우지 말 것 — 공유 프로덕션 Redis의 잡을 집어간다.
- ⚠️ 웹툰→영상은 형제 프로젝트 `C:\myapps\re-animator` 일. 여기서 하지 말 것.
- ⚠️ 로컬에 **ffmpeg 없음**. 합성 필터를 고치면 로컬 검증이 안 되니 배포 후 실합성으로 확인.

---

## 1. ★★ 최대 교훈 — 원칙을 지어내지 마라

**이 채널의 대본 원칙은 `config/script-principles.json`(쇼츠) 하나뿐이다.**
이전 세션이 롱폼용 원칙을 따로 지어낸 것이 모든 품질 사고의 원인이었다.

| 지어낸 것 | 결과 |
|---|---|
| "계좌 착지" 파트 | 약장수 멘트 — "한미반도체가 핵심 수혜예요" |
| 자체 구독 문구 | 채널 표준 문구가 틀어짐 |
| 자체 길이 예산·역할별 글자 상한 | 말이 토막남 — "빅3 구조로.", "답 아직요." |
| 프롬프트에 넣은 **예시 문장** | 모델이 그대로 베낌 |

**지금 구조**: `lib/longformScript.ts`가 `config/script-principles.json` **전문을 그대로 주입**한다(발췌·재서술 금지 — 그 과정에서 원칙이 지어내졌다). 롱폼 파일에서 가져오는 건 세그먼트 순서 설계뿐.

**투자 조언 절대 금지**(예외 없음): 종목 지목·판단 지시·투자 관점 제시 전부. `ending.part_b_landing`은 기본 빈 문자열. `lib/longformScreening.ts`의 `STOCK_PICK` 정규식이 우회 표현까지 잡고, 실제 사고 문장 6종이 테스트로 고정돼 있다. **확장판에서 "착지 확장" 블록을 뺀 것도 이 이유다.**

**검수기는 닫힌 채점표**로 — 항목별 통과/탈락 + 근거 인용만. 목록 밖 지적·문체 취향·대안 제시 금지.

---

## 2. 세 갈래 트랙 (데이터로 구분됨)

| 트랙 | 정체 | 구분 필드 |
|---|---|---|
| **쇼츠** | 9:16 숏폼 뉴스 (원본 파이프라인) | 기본 |
| **컴필레이션** | 검증된 쇼츠 **여러 편**을 16:9로 묶어 롱폼 | `format:"long"` + `sourceProjectIds` |
| **확장판(elongated)** | 검증된 쇼츠 **한 편**을 N배 길이 단일 롱폼으로 늘림 | `Project.elongated` |
| (별도) **연애 클리셰** | 로맨스 프리셋 | `mode:"cliche"` |
| (별도) **시뮬 제조기** | 연애 대화 미니게임 | `/sim/*` |

쇼츠 파이프라인 8단계: source→script→keyframe→images→videos→voiceover→compose→subtitle (`lib/types.ts` STEP_ORDER)

---

## 3. 쇼츠 — 2단계 대본 화면

승인 버튼은 한 줄 통째로, 그 아래 보조 버튼 5종이 **한 줄**(nowrap, 가로 스크롤 금지 — 폰트를 줄여 맞춘다):

`✍️ 대본 다듬기` `🔗 고리 정렬` `🔎 비판 검수` `✨ 제목 생성` `📋 스크립트 복사`

- 고정 프롬프트 본문은 `config/script-buttons.json` **단일 원천**
- **🔎 비판 검수** — 서버사이드 웹 검색(`web_search_20260209`)으로 반대편 사실을 찾음. **동의 전 대본 안 건드림.**
  - 결과는 **버튼 줄 바로 아래에 자동으로 펼쳐진다.** 모달·추가 클릭 없음(사용자가 강하게 요구, 회귀 금지)
  - 항목마다 체크박스: 심각도 · A안(씬 수정)/B안(반전 씬 추가) · 씬 번호 · 원문→수정문 · 근거 링크 · 그림 재생성 여부
  - 빠른 선택: 전체 / A안만 / B안만 / 높음만 / 해제
  - **리포트 전문을 대화 로그에 쏟지 말 것** — 그게 "글만 쭉 나열" 사고의 원인이었다. 로그엔 한 줄 요약, 전문은 결과 패널 안에 접어서.
  - 구현 주의: 검색이 여러 번 도는 응답은 5분+ → **스트리밍 필수**. `pause_turn` 이어 돌리기. `max_uses: 20`. 구조화(JSON 변환)는 **도구 없는 2차 호출로 분리**(1차에 같이 시키면 형식이 깨진다).
  - **씬 추가(insert) 반영 시 뒤 씬 번호가 전부 밀린다** → 남은 항목을 잠그고 재검수 유도(구현돼 있음).
  - 저장: `critique:<projectId>` + 대본 지문. 지문이 다르면 복원 안 함.
- **제목**: `config/title-principles.json`이 쇼츠 제목 6원칙의 유일한 원본. 생성기·검수기 둘 다 `{{PRINCIPLES}}`로 주입.

---

## 4. 컴필레이션 롱폼

```
[진행자 오프닝 2씬] → 세그0 → [연결 1씬] → 세그1 → … → [진행자 엔딩 3씬]
```

- 진행자 씬 하나 = 쇼츠와 같은 **4~7초**
- 세그먼트 = 숏폼을 16:9로 재합성한 별도 프로젝트(`longformId` 귀속). 대본·음성 재활용, 이미지·영상만 재생성
- 진행자 = 별도 프로젝트(`hostProjectId`, 씬에 `hostSlot`/`connectorAfter`)
- 섹션 부분 합성: 세그먼트 2~3편씩 잡을 나눔(`Project.sections`)
- **화면 순서 = 작업 순서**: ①제목 → ②진행자 대본 → ✍️전체 다듬기 → ③진행자 씬 → ④썸네일 → 재생 순서 타임라인 → 섹션 합성

5모듈: 제목(`longformTitleGen/Prompt/Check`) · 대본(`longformScript`) · 검수(`longformScreening`) · 전체 다듬기(`longformReview*`) · 썸네일(`thumbnailGen/Compose/Layout`, 168px 판독 검증)

---

## 5. 확장판 (가장 최근 트랙, 7/26~8/1)

**화면 순서**: `/longform` 상단 탭 [컴필레이션][확장판] → 원본 1편 + 목표 길이 → 스튜디오
①원본(읽기전용) ②목표 길이 ③확장 설계 ④본문 ⑤검수 ⑥렌더로 보내기

- **동의 게이트 2개(회귀 금지)**: 설계 승인 전 본문 라우트가 409 / `expires` 카드 있으면 렌더 직전 "게시 전 재확인"이 409
- **렌더 경로를 새로 만들지 않는다**: 챕터 본문 → 4~7초 씬 배열로 펼치고 `?stage=render`로 기존 스튜디오를 연다. 마지막에 쇼츠 ⑧씬 구독 문구 씬 자동 추가
- **덧붙일 대목 4종**: 근거 심화·사례·반론·배경. **"착지 확장"은 뺐다**(투자 조언 금지와 정면 충돌)
- **검수 = 닫힌 채점표 7항목**(`lib/elongatedScore.ts`) — 6항목은 코드, '열린 고리' 1항목만 모델에 닫힌 질문
- **팩트 대조**(`lib/elongatedFactCheck.ts`)는 모델을 안 쓴다(공짜·의견성 지적 없음). 본문은 쓴 직후 같은 판정으로 검사해 위반만 짚어 1회 재생성

**실측(반드시 기억)**
- 설계+전체검색을 한 요청에 몰면 5분 20초 → Vercel 300초 초과. **설계(검색 없음, 40초)와 사실 찾기(챕터 단위)로 쪼갬**
- **haiku는 web_search를 못 쓴다(400).** 검색은 sonnet, JSON 옮겨 적기만 haiku
- 검색 예산을 챕터당 고정 2회로 묶으면 모델이 "검색 불가"를 내고 카드 0건 → 대목 수 비례(config)
- 대본비 8분 기준 ₩8,900 → **₩2,520**. 영상비 85씬 ≈ ₩60,000이 전체의 **95%**
- 검색 **실패**를 '찾음'으로 기록하면 다시 찾기에서 영영 빠진다

**숫자는 전부 `config/elongated-config.json`.** 품질이 모자라면 `fact_model`·`search_max_uses_per_block`·`chapter_target_sec`만 올린다.

관련 파일: `lib/elongated.ts` `elongatedPlan(+Prompt)` `elongatedBody(+Prompt)` `elongatedFactCheck` `elongatedScore` `elongatedScenes` `elongatedFormat` / `app/longform/new/elongated/` / `app/project/[id]/ElongatedStudio.tsx` / `app/api/longform/elongated/`

---

## 6. 합성 워커 — 큰 수술 완료 (7/25, 검증됨)

**증상이었던 것**: 스크립트가 조금만 길어지면 그 씬 합성에서 워커가 뻗음.

**원인(실측 확정)**: 캡션 1컷 = ffmpeg 입력 1개(`-loop 1`). `-loop` 이미지 입력은 프레임마다 PNG를 다시 디코딩 → 비용이 `씬 길이 × 30fps × 캡션 수` = **스크립트 길이의 제곱**. 실측 인코딩 **2.5fps**, 150초 상한에 걸려 **씬 14초(한국어 ~70자)에서 절벽**.

**수정(`ae3a6fa`, worker build `robust-v1`)**
- 오버레이 입력을 **항상 1개**로 — 캡션 구간이 0부터 빈틈없이 이어지므로 **concat demuxer 목록 1개**로 대체. overlay 1단, PNG 디코드는 컷당 1회
- 워터마크·크레딧은 캡션 PNG에 **미리 합성**해 입력을 안 늘림(`mergePngLayers`)
- ffmpeg 타임아웃을 씬 길이 비례로(초당 8초, 150초~8분)
- **크래시 경로 5종 방어**: `probeDuration`의 `'error'` 리스너 누락(spawn 실패 시 프로세스 즉사) / 10분 타임아웃이 `Promise.race`라 자식을 안 죽여 ffmpeg 2개 동시 실행 / 실패 기록이 try 밖 / `uncaughtException`·`unhandledRejection` 핸들러 0개 / stdout 파이프 포화

**검증 결과(2026-08-01 실측)**

| | 잡 수 | error | 끊김(running) |
|---|---|---|---|
| 수정 전 | 462 | 45 | 57 |
| 수정 후 | **44** | **0** | **0** |

인코딩 타임아웃 에러 0건. **FPS·타임아웃 숫자를 만지는 우회로는 `6218ae4`→`0e2342f`에서 이미 한 번 실패했다 — 반복하지 말 것.**

**진단 레시피(재발 시 그대로)**: `.env.local`의 UPSTASH REST로 `job:*`를 SCAN→MGET 해 status 집계와 에러 메시지를 본다. **에러의 `frame=`·`fps=` 값이 결정적 증거** — fps가 한 자릿수면 필터 그래프가 범인이고 인스턴스 문제가 아니다. `worker:heartbeat`가 실패 시각에 끊겼으면 프로세스 사망, 계속 뛰었으면 잡 실패.

**배포 확인**: Render는 push 자동 배포(수동 요청 금지, 지연 수 분). Redis `GET worker:build`(= `worker/index.mjs`의 BUILD 상수, 커밋마다 갱신) · `GET worker:heartbeat`(1분 주기).

---

## 7. 제거된 기능 (되살리지 말 것)

**구글 드라이브 업로드 전체**(`f58a858`) — 버튼·라우트·OAuth·`lib/google.ts`·`lib/uploadNaming.ts`·`config/upload-taxonomy.json`·업로드 번호 카운터·`Project`의 `driveLink`/`driveFileName`/`driveUploadedUrl`/`uploadKeyword`/`category`.
부수 효과: 라이브러리 정렬이 **순수 최신순**이 됨. `.env`의 `GOOGLE_CLIENT_ID`/`SECRET`은 이제 아무 데서도 안 읽는다.
**앱 로그인은 자체 JWT라 구글과 무관** — 그대로 동작한다.

**라이브러리 "🔢 오늘 번호 갱신"·"📁 드라이브 폴더"**(`64517ff`) — `config/drive.json`도 삭제됨.

---

## 8. 검증 방법

```bash
npx tsc --noEmit                 # 종료코드 확인, 파이프 금지
npm run build                    # 배포 게이트
node --check worker/*.mjs        # + 실제 모듈 로드 테스트도 반드시
```

순수 함수 테스트(무료·빠름):
`scripts/test-longform-screening.ts` · `test-title-consistency.ts` · `test-title-banned.ts` · `test-thumbnail-compose.ts` · `test-elongated-factcheck.ts` · `test-elongated-scenes.ts` · `test-critique-extract.ts` · `test-script-review-parse.ts`

상태 확인: `scripts/elongated-state.ts <projectId>` · `scene-state.ts` · `list-projects.ts` · `cost-by-kind.ts`

로컬 dev 페이지 검증: `$env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/dev-session-token.ts` → 브라우저 `document.cookie`에 `aninews_session` 주입. 포트 3000이 다른 세션에 점유돼 있으면 `.claude/launch.json`의 `autoPort: true`가 다른 포트를 잡는다.

---

## 9. 남은 일 / 미검증

1. **컴필레이션 end-to-end 미완주** — 묶기 → 세그먼트 16:9 재생성 → 섹션별 부분 합성 → 최종 이어붙이기를 한 번도 끝까지 안 해봄
2. **MiniMax 직접 API 실동작 미확인** — 배포는 됐으나 실제 영상 생성 미확인(`lib/minimax.ts`, `config/video-models.json` 기본 `minimax`)
3. **확장판 실사용 검증** — end-to-end 완주(`155b276`)는 했으나 완성본 품질 평가는 미확인
4. 닫힌 채점표 적용 후보(동의 대기): `lib/scriptReviewPrompt.ts`, `lib/longformReviewPrompt.ts`
5. 시뮬 제조기 트랙은 별도 — `HANDOFF-simgame*.md`, 메모리 `aninews-simgame-state` 참조

---

## 10. 사용자가 반복 지적한 것 (지킬 것)

- **원칙을 지어내지 마라.** 쇼츠에 이미 있는 걸 쓴다
- **투자 조언 절대 금지.** 예외 없음
- **작업 순서 = 화면 순서.** "먼저 X를 하라"면서 X 버튼이 아래 있으면 안 됨
- **결과는 자동으로 보여라.** 버튼 하나 더 눌러 여는 인터페이스 금지
- **개발 내부 용어를 화면에 쓰지 마라**(②③④ 대본, 브리지, 세그먼트, 계좌 착지 등)
- **글 덩어리로 쏟지 마라.** 사람이 반영할 것은 체크박스로 쪼개라
- **결과가 화면에 안 뜨는 버그 주의** — `useState(prop)`은 최초 1회만. `router.refresh()` 후 prop 동기화 필요
- **기존 기능·선택지 임의 제거 금지**(목소리 목록을 필터했다가 사용자 애용 목소리를 누락시킨 사고)
- 호칭 쓰지 말 것

---

## 11. 최근 커밋 (신→구, 전부 origin/main)

```
0a08898 feat(longform): 대본 품질 구멍 두 개를 코드 검사로 막음
9b29494 fix(elongated): 본문을 펼쳐서 바로 읽고 고치게
275853f feat(elongated): 본문 재생성 루프 — 팩트 대조·금지 표현
5308aa1 feat(longform): 재생 순서를 화면 맨 위 작업판으로
155b276 feat(elongated): 렌더로 보내기 + 게시 전 재확인, end-to-end 완주
89bd634 feat(elongated): 팩트 대조 + 닫힌 채점표 7항목
131d303 feat(elongated): 본문 생성(챕터 단위)
892bbfd feat(elongated): 확장 설계 + 사실 카드(웹검색)
84e2208 feat(elongated): 확장판 데이터 모델 + 설정 단일 원천
b315e73 feat(video): MiniMax 직접 API 연동
679f96d fix(longform): 내가 지어낸 롱폼 원칙 폐기 — 쇼츠 원칙 그대로
d0c911a fix(longform): 투자 조언 절대 금지
f58a858 chore: 구글 드라이브 업로드 기능 전체 제거
a875899 fix(script): 비판 검수 결과를 버튼 아래에 자동으로 펼침
ae3a6fa fix(worker): 씬 합성 길이 제곱 비용 제거 + 크래시 경로 방어
```
