# 컨텍스트 이전 프롬프트 — aninews-maker21 (롱폼 · 대본 검수 · MiniMax)

> 새 대화창에 이 문서를 통째로 붙여넣고 시작. 이전 대화 없이 이어서 작업할 수 있게 정리했다.

## 0. 환경

- `C:\myapps\aninews-maker21` — Next.js(App Router) + Upstash Redis(프로젝트 상태) + Vercel Blob(미디어) + Render 워커(ffmpeg 합성)
- 프로덕션: https://aninews-maker.vercel.app
- **먼저 읽기**: `C:\Users\kimta\.claude\projects\C--myapps-aninews-maker21\memory\MEMORY.md` 및 관련 메모리 — 특히 `aninews-principles-single-source`, `aninews-longform`, `commit-push-frequently`, `deploy-gates`, `use-korean-honorifics`, `never-claim-cause-without-proof`, `no-unrequested-global-changes`
- **한국어 존댓말. 호칭 쓰지 말 것**(‘사장님’ 등 금지 — 사용자가 여러 번 지적).
- 게이트: `npx tsc --noEmit` 종료코드 확인(파이프 금지). 워커 만지면 `node --check worker/*.mjs` + 실제 모듈 로드. 로컬 `npm run build`는 Google Fonts 네트워크로 실패할 수 있음.
- 자주 커밋 + `git push origin main` + SHA 보고.
- ⚠️ 로컬에서 `worker/index.mjs` 띄우지 말 것 — 공유 프로덕션 Redis의 잡을 집어간다.
- ⚠️ 웹툰→영상은 형제 프로젝트 `C:\myapps\re-animator` 일. 여기서 하지 말 것.

## 1. ★★ 이번 세션 최대 교훈 — 원칙을 지어내지 마라

**이 채널의 대본 원칙은 `config/script-principles.json`(쇼츠) 하나뿐이다.**

내가(이전 세션 Claude가) 롱폼용 원칙을 따로 만든 것이 모든 사고의 원인이었다:

| 내가 지어낸 것 | 결과 |
|---|---|
| "계좌 착지" 파트 | 약장수 멘트 — "한미반도체가 핵심 수혜예요", "장비주 실적이 먼저 움직이는 구조예요" |
| 자체 구독 문구 | 채널 표준 문구를 틀리게 만듦 |
| 자체 길이 예산(5~7/3~5/10초) + 역할별 글자 상한 | 말을 토막 냄 — "빅3 구조로.", "답 아직요." |
| 프롬프트·원칙 파일의 예시 문장 | 모델이 그대로 베낌 — "세 판 봅니다", "끝까지 보시면 ~보여요", "아직 처음 질문의 답이 안 나왔어요" |

**지금 구조(되돌린 뒤)**: `lib/longformScript.ts`가 `config/script-principles.json` **전문을 그대로 주입**한다(발췌·재서술 금지 — 그 과정에서 원칙을 지어냈다). 롱폼 파일에서 가져오는 건 세그먼트 순서 설계뿐. 구독 문구는 `shortsPrinciples.structure.scene_8.text`를 코드로 참조. 씬 길이는 `lib/scenes.ts`의 `DURATION_MAX`(7초)가 원천.

**투자 조언 절대 금지**(사용자 강조, 예외 없음): 종목 지목·판단 지시·투자 관점 제시 전부. `ending.part_b_landing`은 기본 빈 문자열. `lib/longformScreening.ts`의 `STOCK_PICK` 정규식이 우회 표현까지 잡고, 실제 사고 문장 6종이 테스트로 고정돼 있다.

## 2. 롱폼 구조 (확정)

```
[진행자 오프닝 2씬] → 세그0 → [연결 1씬] → 세그1 → … → 세그N-1 → [진행자 엔딩 3씬]
```

- 진행자 씬 하나 = 쇼츠 씬과 같은 **4~7초**. 오프닝 2씬 / 연결 N-1씬 / 엔딩 3씬(답·여운(보통 빈칸)·구독 문구)
- 세그먼트 = 숏폼을 16:9로 재합성한 별도 프로젝트(`format:"long"`, `longformId` 귀속). 대본·음성 재활용, 이미지·영상만 재생성
- 진행자 = 별도 프로젝트(`hostProjectId`, 씬에 `hostSlot`/`connectorAfter`)
- 섹션 부분 합성: 세그먼트 2~3편씩 묶어 잡을 나눔(OOM 대응). `Project.sections`

**화면 순서(작업 순서 = 화면 순서)**: ① 제목 → ② 진행자 대본 → ✍️ 전체 다듬기 → ③ 진행자 씬 → ④ 썸네일 → 재생 순서 타임라인 → 섹션 합성

## 3. 파이프라인 5모듈

| 모듈 | 파일 | 비고 |
|---|---|---|
| ① 제목 | `lib/longformTitleGen.ts`, `longformTitlePrompt.ts`, `longformTitleCheck.ts` | 검색 5원칙(`config/longform-principles.json`의 title). **묶음 표시어 금지**(총정리·몰아보기·N편·N가지·TOP N). 제목 확정(`finalTitle`)이 이후 모듈의 게이트 |
| ② 대본 | `lib/longformScript.ts`, `longformScriptPrompt.ts` | 오프닝·연결·엔딩 일괄. 쇼츠 원칙 주입. 위반 시 최대 2회 재생성 |
| 검수 | `lib/longformScreening.ts` | 씬 길이·연결 수·금지 표현·**종목추천/투자조언**·내부 용어 |
| 전체 다듬기 | `app/api/longform/review/route.ts`, `lib/longformReview*.ts` | 세그먼트 대본까지 읽고 훅 구조·순서 진단 + 채택 반영 |
| ③ 진행자 씬 | `app/api/longform/host-script/route.ts` | 대본을 씬으로 펼침 |
| ④ 썸네일 | `lib/thumbnailGen.ts`, `thumbnailCompose.ts`, `thumbnailLayout.ts` | 구도 3종 + 글씨 후처리(@napi-rs/canvas), 168px 판독 검증 |
| 조립 | `GET /api/longform/package` | 전체 산출물 JSON |

**세그먼트 요약 예산**(10분+ 롱폼 대비): 총량을 편수로 나눠 배분 — 대본·다듬기 60,000자, 제목 40,000자. 편당 상한 3000/2000자. 잘릴 때만 "…(이하 생략)".

## 4. 쇼츠 제목 원칙 단일화 (완료)

- `config/title-principles.json` = 쇼츠 제목 6원칙의 유일한 원본. 생성기(`titlePrompt.ts`)·검수기(`titleReviewPrompt.ts`) 둘 다 `{{PRINCIPLES}}`로 주입
- **①>③ 충돌 규칙** 추가: 서랍 선두(①)가 괴리 앞세움(③)을 이긴다(버핏편 실증)
- **검수기는 닫힌 채점표**: 항목별 통과/탈락 + 근거 문구 인용만. 목록 밖 근거·문체 취향·대안 제시 금지. 전 항목 통과면 총평 "통과" 한 단어
- **자기일관성 테스트**: `scripts/test-title-consistency.ts` — 생성기 출력을 검수기에 통과시킴. 3소재 3연속 통과 확인. 이 테스트가 "선두 = 첫 어절"을 생성기가 느슨하게 보던 버그를 잡았다

## 5. 2단계 대본 버튼 2종 (쇼츠)

- 🔗 **고리 정렬** — 고정 프롬프트를 대본 대화 경로로 실행
- 🔎 **비판 검수** — 서버사이드 웹 검색(`web_search_20260209`)으로 반대편 사실을 찾아 2부 리포트. **동의 전 대본 안 건드림**. 다른 세션이 체크박스 반영 UI를 붙임(`lib/scriptCritiqueLog.ts`)
- 프롬프트 본문은 `config/script-buttons.json` 단일 원천
- 구현 주의: 웹 검색 여러 번 도는 응답은 5분+ → **스트리밍 필수**(비스트리밍은 타임아웃). `pause_turn` 이어 돌리기. `max_uses: 20`(5회로는 한도 소진돼 "검증 보류"만 나옴)

## 6. MiniMax 직접 API (완료·배포됨)

- `lib/minimax.ts` — re-animator `worker/minimax.mjs`에서 이식. 3단계(task → file_id → download_url), 호스트 failover(minimax.io/minimaxi.com/minimaxi.chat), env 이름 흔들림 흡수, fetch cause 노출
- `config/video-models.json`: 기본 `minimax`가 직접 API(`endpoint: MiniMax-Hailuo-2.3`). fal 경유는 `minimax-fal`로 대안 보존
- **Vercel env `MINIMAX_API_KEY` 설정 완료**(사용자가 넣음). 로컬 `.env.local`엔 없음
- 드롭다운 라벨에서 프로바이더 이름(fal 등) 제거

## 7. 이번 세션 커밋 (전부 origin/main)

| SHA | 내용 |
|---|---|
| `33c53e0` | 2단계 버튼 2종(고리 정렬·비판 검수+웹검색) |
| `d1b98da` | 진행자 구간 단축 + 재생 순서 타임라인 UI |
| `c03447c` | 생성 결과 화면 미반영 버그 + 길이 강제 |
| `171aba4` | 롱폼 묶기 검색(선택 순서 유지) |
| `2d6cd69` | 쇼츠 제목 원칙 단일 파일 + 닫힌 채점표 + 자기일관성 |
| `e0e1edc` | 연결 멘트 품질 사고 3건 + 패널 순서·용어 |
| `99ce1f4` | 진행자 멘트를 쇼츠 원칙으로 되돌림 |
| `05af486` | 세그먼트 요약 확대(10분+ 대비) |
| `679f96d` | **내가 지어낸 롱폼 원칙 폐기 — 쇼츠 원칙 그대로** |
| `b315e73` | MiniMax 직접 API |
| `d5e2e61` | 드롭다운 라벨 정리 |
| `d0c911a` | **투자 조언 절대 금지** |

## 8. 남은 일

1. **투자 조언 금지 이후 대본 재검증** — 마지막 커밋(`d0c911a`) 뒤로 실제 생성 안 해봄. 엔딩 여운이 실제로 비는지 확인
2. **end-to-end 미검증** — 묶기 → 세그먼트 16:9 재생성 → 섹션별 부분 합성 → 최종 이어붙이기를 한 번도 완주 안 함
3. **MiniMax 프로덕션 실동작 확인** — 배포는 됐으나 실제 영상 생성 미확인
4. 닫힌 채점표 적용 후보(동의 대기): `lib/scriptReviewPrompt.ts`, `lib/longformReviewPrompt.ts` — 사본 문제는 없으나 열린 지시라 목록 밖 지적 가능
5. 비판 검수 프로덕션 타임아웃 — 13씬 검수가 단일 응답 5분+. Vercel `maxDuration 300` 상한에 걸릴 수 있음(필요 시 워커 잡으로)

## 9. 검증 방법

- 워커 생존: `.env.local`의 UPSTASH REST로 Redis `GET worker:heartbeat`(최근이면 alive)·`GET worker:build`
- 순수 함수 테스트: `npx tsx scripts/test-longform-screening.ts`(씬 길이·금지어·종목추천 6종), `scripts/test-title-consistency.ts`(제목 3연속), `scripts/test-thumbnail-compose.ts`
- 로컬 dev 페이지 검증: `$env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/dev-session-token.ts` → 브라우저 `document.cookie`에 `aninews_session` 주입
- 브라우저 JS 실행은 30초 캡 — 긴 API는 `fetch(...).then(d => window.__x = d)`로 띄우고 나중에 확인

## 10. 사용자가 반복 지적한 것 (지킬 것)

- **원칙을 지어내지 마라.** 숏폼에 이미 있는 걸 쓰라고 여러 번 말했다
- **투자 조언 절대 금지.** 예외 없음
- **작업 순서 = 화면 순서.** "먼저 X를 하라"면서 X 버튼이 아래 있으면 안 됨
- **개발 내부 용어를 화면에 쓰지 마라**(②③④ 대본, 브리지, 세그먼트, 계좌 착지 등)
- **결과가 화면에 안 뜨는 버그 주의** — `useState(prop)`은 최초 1회만. `router.refresh()` 후 prop 동기화 필요
- 호칭 쓰지 말 것
