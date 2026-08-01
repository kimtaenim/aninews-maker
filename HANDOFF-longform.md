# 컨텍스트 프롬프트 — aninews-maker21 롱폼(가로) 모드 추가

> 새 대화창에 이 내용을 통째로 붙여넣고 시작. 이전 대화 없이도 이어서 작업할 수 있게 정리했다.
> 이건 **설계·검토 착수용** 문서다. 아직 코드 안 짬 — 먼저 물어가며 설계 합의부터.

## 0. 프로젝트가 뭔지
- `aninews-maker21` @ `C:\myapps\aninews-maker21` — 숏폼(세로 9:16) 영상 제작 파이프라인.
  Next.js(App Router) + Upstash Redis(프로젝트 상태) + Vercel Blob(이미지·영상·오디오 파일) + Render 백그라운드 워커(ffmpeg 합성).
- 한 "프로젝트" = 영상 한 편. 8단계 상태머신: **source → script → keyframe → images → videos → voiceover → compose → subtitle**. 씬 단위 리롤.
- 모드: `news`(뉴스 숏폼, 기본)·`cliche`(연애 클리셰). `lib/types.ts` 의 `Project`/`Scene`/`SubtitleSettings` 가 핵심 타입.

## 1. 목표 — 롱폼(가로) 모드
1. **가로로 길어야 함** — 지금은 세로 9:16 고정. 롱폼은 16:9(가로).
2. **자막 위치 3종 택1** — 위에서 1/3(one-third)·중앙(center)·2/3(two-thirds) 중 선택. (지금은 6종.)
3. **마무리 구독 씬은 딱 하나** — 숏폼처럼 매 편 붙이지 말고, **합쳐진 전체의 마지막에만** 구독·좋아요 씬 1개.
4. **숏폼 3~5개를 합쳐 5분짜리 롱폼** — 이미 만든 숏폼들을 이어붙여 롱폼 완성.
5. **DB/워커가 버티는지 먼저 확인** — 아래 4번 참고.

## 2. 지금 "세로 9:16"이 하드코딩된 지점 (롱폼에서 파라미터화 필요)
- `lib/openai.ts` → `IMAGE_SIZE = "1008x1792"` (gpt-image-2 세로). 이미지 생성 크기.
- `worker/compose.mjs` → `const W = 1080; const H = 1920;` (합성 캔버스). ffmpeg scale/crop·자막·워터마크 전부 이 W/H 기준.
- `config/video-models.json` → Seedance `defaultParams: { aspect_ratio: "9:16", resolution: "1080p" }`. (MiniMax·Kling·Grok 은 defaultParams 비어 있어 입력 이미지 비율을 따름 → 이미지 비율이 가로면 영상도 가로.)
- UI: `aspect-[9/16]` 클래스가 여러 곳(스튜디오 4·5단계 그리드, `app/project/[id]/ScenePreview.tsx` 미리보기, 최종 영상 표시). 가로용 `aspect-[16/9]` 분기 필요.
- **접근 제안**: `Project` 에 `format: "short" | "long"` (또는 `aspectRatio`) 필드 추가 → 이미지 크기·워커 W·H·fal aspect·UI 클래스가 전부 이 값을 참조하게. 한 곳에서 결정되게 하는 게 핵심.

## 3. 자막·마무리 씬 관련 파일
- **자막 위치 타입**: `lib/types.ts` `SubtitleSettings.position` = `top|one-third|center|two-thirds|three-quarters|bottom` (6종). 롱폼은 `one-third|center|two-thirds` 3종만 노출.
- **자막 위치 → 이미지 "비워둘 영역"**: `lib/image.ts` `edgeSafe(position)` 가 자막 자리엔 인물·주요물체 안 오게 + 반대편에 배치하라는 프롬프트를 만든다(세로 기준 상/중/하 매핑). 가로에서도 3종에 맞게 재검토.
- **워커 자막 렌더**: `worker/subtitle-image.mjs`(캡션·워터마크·크레딧 PNG 렌더) + `lib/subtitle.ts`(위치 계산). W/H·position 매핑이 가로에서 맞는지 확인. 미리보기/워커 동일 알고리즘 규약(`lib/captions.ts` ↔ `worker/captions.mjs`) 지킬 것.
- **마무리 구독 씬**: `lib/outro.ts` `appendNewsOutro(scenes)` — 마지막 씬이 이미 구독/좋아요면 안 붙임(중복 방지). 지금은 `/api/script`·`/api/source/from-script` 가 **프로젝트마다** 붙임. 롱폼은 합칠 때 개별 숏폼의 마무리 씬은 빼고, 롱폼 전체 끝에 **한 번만** 붙여야 함.

## 4. 합치기 & DB/워커 용량 (가장 중요한 설계 결정)
- **합치기 방식 미정 — 여기부터 합의**:
  - (A) **참조형**: 롱폼 프로젝트가 숏폼 프로젝트 id 3~5개를 참조 → 합성 워커가 각 숏폼의 씬 영상들을 순서대로 이어붙이고 마지막에 구독 씬. 원본 숏폼 안 건드림.
  - (B) **복사형**: 숏폼들의 씬(scene 객체)을 롱폼 프로젝트 `scenes[]` 로 복사해 하나의 긴 프로젝트로. 편집 유연하지만 데이터 커짐.
  - 각각 편집/재생성/일관성 트레이드오프 있음 — 사용자와 정한다.
- **DB(Redis) 용량**: 프로젝트는 Redis 에 **JSON 한 덩어리**(`project:<id>`)로 저장되고, **미디어(이미지·영상·오디오)는 Blob 에 있고 Redis 엔 URL 문자열만** 들어간다. 그래서 씬 수가 3~5배(→ 20~40씬)로 늘어도 JSON 은 수십 KB 수준 → Upstash 값 크기는 여유. **DB 자체는 대체로 버틴다**(단, 복사형이면 프롬프트·타임스탬프까지 커지니 실측 권장).
- **진짜 병목 = 합성 워커 메모리**: 워커는 메모리 빡빡한 Render Background Worker(과거 OOM 이력 있음 — 합성 루프서 이미지 픽셀연산 금지·자막위치 미리 계산 규약). 5분(20~40씬) 영상 = 그만큼 다운로드 + ffmpeg concat/인코딩 → **메모리·시간이 버티는지 스파이크 검증부터** 해야 한다. 필요시 인스턴스 상향(대시보드 권한 필요, Claude 불가).
- **배포 검증**: 워커는 push 자동 배포(수동 요청 금지, 지연 있음). `.env.local` 의 UPSTASH REST 크레덴셜로 Redis `worker:build`(빌드 표식)·`worker:heartbeat`(1분 갱신) GET 해서 확인. 워커 만졌으면 `worker/index.mjs` 의 `BUILD` 상수 갱신.

## 5. 반드시 지킬 규약 (어기면 사고)
- **한국어. 전문적 톤 — 욕설 금지**(사용자가 화나서 욕해도 따라·되받지 말 것).
- **물어가며** — 큰 기능/데이터모델 결정은 **설계안 먼저 제안·확인 후 구현**. 검증 전엔 "가설"이라 말할 것.
- **불만 토로를 지시로 오해 금지. 전역 기본값·config 를 명시적 요청 없이 바꾸지 말 것**(과거 Kling 디폴트 임의 변경 사고).
- **기존 기능·선택지 임의 제거/축소 금지.** 숏폼 파이프라인 회귀 없게(롱폼은 분기로 추가, 기존 세로 경로 유지).
- **절차(매 변경)**: 구현 → `npx tsc --noEmit`(워커 만졌으면 `node --check worker/*.mjs`) → 커밋 → `git push origin main` → SHA 보고. **로컬 `npm run build` 는 Google Fonts 네트워크로 실패하니 tsc 로 게이트.**
- **저장 규약**: getProject↔saveProject 사이에 긴 await(생성 API)가 있으면 저장 직전 `const fresh = await getProject(id)` 재읽기 후 **의도한 필드만 머지**(통째 저장 금지 — 병렬 생성 상호 덮어쓰기 사고).
- **로컬 dev 는 이 환경에서 불안정**: 포트 3000 이 다른 세션 점유하는 경우 있고, 로컬 서버엔 **Vercel Blob·TTS 크레덴셜이 없어** 오디오/이미지 업로드가 실패한다. 프로덕션 데이터 대상 작업은 `BULK_BASE=https://aninews-maker.vercel.app` 로 스크립트 실행(선례: `scripts/bulk-speed-1.2.mjs`). 로그인 필요한 페이지 검증은 세션 JWT(`.env.local` `SESSION_SECRET` 으로 서명, 쿠키명 `aninews_session`) 주입.

## 6. 첫 할 일 제안 (이 순서로 물어가며)
1. **합치기 방식(참조형 vs 복사형) + 데이터 모델** 합의 — `Project.format`/`aspectRatio`, 롱폼↔숏폼 관계 필드.
2. **용량 스파이크** — 5분(20~40씬) 합성이 Render 워커에서 메모리·시간 버티는지 실측(작은 프로토타입 합성 1건).
3. 통과하면 **세로 고정 지점 파라미터화**(2번 파일들) + 자막 3종 + 마무리 씬 1회 로직.

## 7. 참고 문서
- `HANDOFF.md`(프로젝트 전반), `HANDOFF-improve.md`(개선 이력) — 같은 폴더에 있음.
