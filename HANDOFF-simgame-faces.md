# 이식용 핸드오프 ③ — 시뮬 게임 얼굴(표정) 미해결 + 전체 상태

> 새 세션에 이 파일을 붙여넣고 이어서 해결한다. **최우선 미해결 = 표정 얼굴이 프로덕션(Vercel)에서 안 뜸.**
> 자매 문서: HANDOFF-simgame.md(게임 원설계), HANDOFF.md(ani-cliché 전반).

## 0. 필수 규칙 (지금까지 어겼음 — 반드시 지킬 것)
- **한국어. 전문적 톤 — 사용자가 욕해도 절대 따라하거나 되받지 말 것.**
- **검증 전엔 "원인 찾았다" 확정 금지.** 이번 세션 최대 실패 = **베르셀 실제 에러를 못 본 채로 추측만 반복**(사이즈 탓, 타임아웃 탓, Blob 탓…)해서 사용자를 몇 시간 격분시킴. **추측 금지. 실제 에러 먼저 확보.**
- **사용자가 안 시킨 기능 임의 제거 금지.** (표정을 맘대로 5→1장 줄이고, 자동생성 뺐다가 크게 혼남.)
- 절차: 구현 → `npx tsc --noEmit` → 커밋 → `git push origin main`(Vercel 자동배포) → SHA 보고.

## 1. ★ 최우선 미해결: 표정 얼굴이 프로덕션에서 안 뜬다

### 증상 (사용자 보고)
- 플레이 화면 큰 얼굴 자리에 **첫 글자(예 "마")만** 뜨고 얼굴이 안 나옴.
- "표정 얼굴 만드는 중"에서 **먹통** → **에러 자꾸 남**. "40초 이하? 뻥." → 즉 오래 걸리다 실패.
- **얼굴 생성 자체가 아니라 '표정(4장 edit)'이 문제**라고 사용자가 명시.

### 확인된 사실 (추측 아님, 데이터로 검증)
- **이미지 생성은 베르셀에서 정상.** 오늘·어제 프로젝트에 실제 Blob URL(`lfbh6tgvrz42s916.public.blob.vercel-storage.com`)로 키프레임·씬 이미지 있음.
- **얼굴 생성 흐름이 베르셀에서 2번 완료됨.** Redis `cost:entries`에 `meta.kind=="sim-faces"` 2건(최고돈 06:34, 최고돈 06:57, 각 $0.055=5장). → `generateExpressionFaces`가 `recordCost`(맨 끝)까지 돌았다는 뜻. **but** 그 게임들엔 `faces`가 안 남음(게임 삭제됐거나 저장 실패). costUsd는 성공/실패 무관하게 5장분 무조건 더해져서, **표정 4장이 실제 성공했는지는 cost로 알 수 없음.**
- **로컬 `.env.local`엔 `BLOB_READ_WRITE_TOKEN` 없음.** → 로컬에선 모든 이미지 저장 실패("No blob credentials"). 그래서 **얼굴 생성은 로컬에서 최종검증 불가**(생성 품질만 OpenAI 직접호출 스크립트로 확인). 이미지 작업은 전부 프로덕션에서 함.
- **생성 품질·일관성은 좋음(로컬 스크립트로 확인).** 중립 1장 생성 → 그걸 레퍼런스로 `images.edit` 4장(미소·찌푸림·발그레·삐짐). 같은 얼굴 유지, 표정 뚜렷.
- **시간(로컬 OpenAI 직접):** 1024x1024 병렬 5장 ≈ **22초**. 1008x1792는 edit 한 장에 **34초**(느림) → 세로 사이즈로 바꾸면 더 느려짐. **사이즈는 원인 아님**(gpt-image-2에서 사이즈 에러 안 남 — 사용자가 여러 번 확인해줌). 현재 1024x1024 유지.

### 가장 유력한 가설 (미확정 — 실제 에러로 확인 필요)
- **4~5장을 한 Vercel 요청에서 동기 생성 → 오래 걸려 타임아웃/게이트웨이 504.** 로컬 병렬 22초지만 Vercel에선 OpenAI 동시요청이 직렬화되어 100초+ 가능 → "먹통 후 에러". 2건만 완료되고 대부분 실패한 것과 일치.
- 또는 `images.edit` 병렬 호출이 계정 동시성 한도에 걸려 일부 실패(→ `catch`가 삼켜서 표정 없이 넘어감).
- **aninews 패턴:** 무거운 생성은 **1장씩 엔드포인트**(cast/portrait·image/scene = 1장, 프로덕션에서 잘 됨) 또는 **Render 워커**(async). 5장을 한 요청에 넣은 게 안티패턴일 가능성.

### 방금 배포한 계측 (SHA 98dcac5) — 다음 세션은 이걸로 실제 에러부터 봐라
- `generateExpressionFaces`가 표정 edit 실패를 **삼키지 않고** `errors: string[]`로 반환.
- `/api/sim/faces/backfill` 응답에 `faceErrors` 포함.
- 플레이 화면: 얼굴 생성 실패 시 **빨간 실제 에러 텍스트**를 얼굴 자리에 표시. 부분실패는 주황 텍스트.

### 다음 세션 첫 할 일 (순서대로)
1. **프로덕션 URL 확보** (사용자가 배포한 Vercel 주소). 사용자에게 받거나, git remote `github.com/kimtaenim/aninews-maker` 기준 Vercel 대시보드에서 확인. `aninews-maker.vercel.app` 등 후보 curl로 확인 가능(사용자가 알려주는 게 빠름).
2. **그 프로덕션 `/api/sim/faces/backfill`을 직접 호출**(세션 토큰 쿠키로 인증 — 아래 참고)해서 **실제 에러·소요시간을 내 눈으로** 본다. `faceErrors` 확인.
3. 그 에러에 따라 확정 수정:
   - 타임아웃이면 → **1장씩 별도 요청(progressive)** 또는 **Render 워커로 async 오프로드**. (사용자: 병렬 5장은 문제 아니라고 했지만, 실제는 요청 길이가 문제일 수 있음 — 데이터로 판단.)
   - 동시성/rate limit이면 → 순차 or 재시도.
   - 그 외 실제 에러대로.
4. **절대 추측으로 기능 빼거나 사이즈 바꾸지 말 것.**

### 얼굴 관련 파일
- `lib/simFaces.ts` — `generateExpressionFaces({blobPrefix, projectId, name, archetype})` → 중립 generate + 4 parallel `images.edit`, uploadAsset, 반환 `{faces, costUsd, errors}`. 1024x1024, low.
- `app/api/sim/faces/backfill/route.ts` — 게임 상대에 얼굴 생성·저장(fresh 재읽기 머지). maxDuration 300.
- `app/api/sim/faces/route.ts` — 무상태 생성(제조기용, 현재 미사용).
- `app/sim/[id]/play/PlayClient.tsx` — `ensureFaces(t)`: 얼굴 없는 인물 처음 플레이 시 backfill 자동 호출(백그라운드). 큰 얼굴 표시(`pickFaceUrl`, `nextExpr`로 상태별 표정 교체), `faceErr` 노출.
- 표시 로직: `pickFaceUrl` = faces[expr] → faces.neutral → portraitUrl → 첫글자. `nextExpr` = 싫음↑→frown, 좋음↑→smile/blush, 삐짐→sulk, 2턴 유지.

## 2. 시뮬 게임 전체 상태 (그 외는 잘 됨, 배포됨)

**무엇:** aninews 위 연애 대화 미니게임. ani-cliché 인물 또는 직접 만든 인물과 대화하며 마음 얻기. 내부 테스터 배포 준비.

- **감정 2축**(lib/simChat.ts, Haiku): **좋음**(0~100 승리지표)·**싫음**(0~100). 시작 좋음15/싫음35(높은 벽). 채점 비대칭 — **싫음 팍팍(비판·냉담·지뢰·성의없음), 좋음 드물게(특별한 순간만)**. 좋음≥45면 저절로 싫음 완화. 삐짐=싫음≥60(정확한 사과로만 풀림), 파탄=싫음≥90. 승리=좋음≥75 AND 싫음≤30. **JSON 한줄·숫자 앞 + 금지(파서가 제거), max_tokens 800.**
- **캐릭터 개성(방금 강화, 배포됨):** 시스템 프롬프트 맨 앞 "연기 지침(제일 중요)" — 무난하게 순하게 굴지 마라, 아키타입 과장(마초남=거칠오만, 재벌남=도도명령조, 츤데레=쏘아붙이기…). 페르소나(lib/simPersona.ts)에 대표 대사 2개 필수, 현대 말투(자네 금지, 거만인물=반말). **검증됨: 재벌남·마초남·순정남 확실히 구별.**
- **관계 기억 온톨로지:** `config/sim-memory-ontology.json`(fact/preference/sensitive/promise/moment/bond). 옛 대화에서 영구기억만 뽑아 매턴 주입. 아픈곳(sensitive)은 화나면 급소 찌르는 무기.
- **상황 이벤트:** lib/simSituations.ts. 코드가 4~7턴 사이 주사위, Claude가 연기.
- **이어하기·기록:** simplay 저장. getResumablePlays로 진행중 세션 이어받기(+"↻ 처음부터"). `/sim/watch`(구경, `?mine=1` 내 기록).
- **숫자 숨김:** 플레이·구경 화면은 좋음/싫음 두 '바'만, 정확한 숫자·턴별 델타 감춤(감정은 얼굴·바로만). 개발자 비용 푸터는 관리자(ADMIN_EMAIL=kimtaenim@gmail.com)에게만.
- **진입:** 홈/헤더 아님 → `/cliche/new`(💘 연애 클리셰) 우상단 "🎮 시뮬 제조기" → `/sim`. `/sim/new` 제조기(클리셰에서/직접 만들기 토글, 페르소나 2단계 자동생성, 컷씬 선택).
- **테스터 가이드:** Claude 아티팩트 `https://claude.ai/code/artifact/d4ad9689-7bd5-4c3f-8177-4482015ba7ef` (`/sim`에 "📖 가이드" 버튼). 사용자가 공유 켜야 테스터가 봄.

## 3. 인프라·확인용 스니펫
- Next(App Router)/Vercel + Render Worker + Upstash Redis + Vercel Blob. 텍스트=Anthropic(lib/anthropic.ts, MODELS.haiku), 이미지=gpt-image-2(lib/openai.ts, `OPENAI_IMAGE_MODEL` env로 override 가능), Blob=lib/blob.ts(uploadAsset).
- **로컬 dev:** `npm run dev`(포트 3000). BLOB 토큰 없어 이미지 저장 실패 — **이미지 기능은 프로덕션에서 검증.**
- **Redis 직접 조회**(로컬): `.env.local`의 UPSTASH_REDIS_REST_URL/TOKEN으로 `@upstash/redis`. sorted set: `simgame:index`, `simplay:index:all`, `simplay:index:<gameId>`. 키: `simgame:<id>`, `simplay:<id>`. 비용: list `cost:entries`.
- **프로덕션 API 호출용 세션 토큰**(SESSION_SECRET로 서명, kimtaenim@gmail.com): 스크립트로 mint — `.env.local` SESSION_SECRET을 jose HS256으로 서명해 쿠키 `aninews_session=<jwt>`. (이번 세션 scratchpad에 mint-session.mjs 있었음.)

## 4. 최근 커밋 (시뮬 관련, 최신순 위)
- 98dcac5 얼굴 표정 실패 원인 노출(계측) ← 여기서 이어짐
- 5c86883 캐릭터 개성 강화(연기 지침+대표대사)
- ff016ea 이어하기+내 기록
- 281aff0 좋음/싫음 2축+기억 온톨로지+비용 푸터
- (그 사이 얼굴 관련 여러 커밋 — 5장↔1장 왔다갔다 한 흑역사 있음, 현재 5장 유지)

## 5. 첫 지시 예시 (새 세션)
"HANDOFF-simgame-faces.md 읽었지. 표정 얼굴이 프로덕션에서 안 뜨는 문제부터. 추측하지 말고, 배포주소 [URL] 알려줄 테니 거기 /api/sim/faces/backfill 직접 호출해서 실제 faceErrors 보고 원인 확정한 다음 고쳐라."
