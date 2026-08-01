# 이식용 핸드오프 ③ — 애니뉴스·애니클리셰 개선 작업

> 새 세션에 이 내용을 붙여넣고 시작. 이전 대화 없이도 이어서 작업할 수 있게 정리했습니다.
> 자매 문서: `HANDOFF.md`(프로젝트 전반·구축 이력 상세), `HANDOFF-simgame.md`(시뮬 제조기 게임 — 별도 트랙).

## 0. 필수 규칙
- **한국어 대화. 전문적 톤 — 욕설 금지**(사용자가 화나서 욕해도 따라하거나 되받지 말 것).
- **"물어가면서"** — 큰 기능은 설계안 먼저 제안·확인 후 구현. 검증 전엔 "가설"이라 말할 것.
- **기존 기능·선택지 임의 제거/축소 금지.** 사례: 목소리 목록을 ElevenLabs로만 필터했다가 사용자 애정 목소리(Typecast 뱀파이어 킬리언) 누락 사고 → 목록류는 전부 노출이 원칙.
- **절차(매 변경):** 구현 → `npx tsc --noEmit`(워커 만졌으면 `node --check worker/*.mjs`) → 커밋 → `git push origin main` → SHA 보고. 로컬 `npm run build`는 Google Fonts 네트워크로 실패하니 tsc로 게이트.

## 1. 지켜야 할 핵심 컨벤션 (어기면 회귀)
- **저장 규약**: Redis 프로젝트 저장은 last-write-wins. **getProject↔saveProject 사이에 긴 await(생성 API)가 있는 라우트는 저장 직전 `const fresh = await getProject(id)` 재읽기 후 의도한 필드만 머지**(에러 경로 포함). 통째 저장이 sfx 클로버 사고 원인이었음(0985f75). 즉시 저장(ms 창)은 그대로 둬도 됨.
- **워커 배포 검증**: Render 워커는 push 자동 배포 작동(수동 요청 금지, 지연 수 분~수십 분). 검증은 Redis `worker:build`(빌드 표식, worker/index.mjs BUILD 상수 — 커밋마다 의미 있게 갱신)·`worker:heartbeat`(1분 갱신)를 .env.local 의 UPSTASH REST 크레덴셜로 GET. 현재 배포 목표: **cliche-v13**(클린 합성).
- **TTS 엔진 판별**: 목소리 id `tc_` 프리픽스=Typecast, 아니면 ElevenLabs — `lib/tts.ts synthesize()`가 id로 자동 판별(인물별 혼용 가능). **감정 연기 태그는 ElevenLabs 전용**(Typecast로 더빙될 줄/씬은 감정 UI 잠금됨).
- **영상 톤**: 뉴스=잔잔(subtle), **클리셰=무조건 MV**(기본 motionScale=크게=video_motion.cliche, 잔잔 선택 시 cliche_calm). Grok(xAI)이 주력 모델(새 클리셰 기본값 grok). MV 프롬프트 원칙: 정지 앵커("Camera only/subject barely moves") 금지, 시작→끝 프레이밍 변화 명시, 속도 변화 영어로 명시, NEVER timid. 관련 4곳 한 세트: config/prompts.json video_motion + Studio CLICHE_CAMERA_MOVES + lib/sceneFill generateMotions(cliche) + script_cliche 지시.
- **딥페이크 방지**: 업로드한 실제 얼굴은 그림체와 무관하게 항상 웹툰 스타일화 변환만.

## 2. 배포 후 검증 대기 (사용자와 확인할 것)
1. **Grok MV v2 (0be514a)** — "그록 밋밋" 피드백으로 v2 튜닝함. 테스트 방법: **모션 재생성(또는 카메라 프리셋 재클릭) 후 영상 리롤**(씬에 저장된 옛 모션 문구로 리롤하면 반쪽 테스트). 결과 좋으면 **같은 기조를 re-animator(C:\myapps\re-animator)의 worker/jobs.mjs MOTION_GUIDANCE + Studio CAMERA_MOVES에 이식하기로 사용자와 합의됨.** 여전히 밋밋하면 다음 용의자: Grok duration 파라미터 등 프롬프트 밖 요인.
2. **테스터 불만 수정분 (54cbd31)** — ①분위기 씬↔일반 씬 전환 토글 ②대사 수정 시 낡은 오디오 자동 무효화(자막 싱크 뿌리) ③"🎞️ 영상만 합성(클린)" 버튼(보이스·자막·효과음·워터마크 제외, 타이밍은 음성 기준 유지, cleanVideoUrl 별도 저장). **워커 cliche-v13 배포 확인됨(2026-07-15 Redis worker:build).** ⚠️ 단 그 시점 heartbeat가 ~9분 지연 관찰됨(정상은 1분 주기) — 합성이 안 돌거나 큐가 안 빠지면 워커 프로세스 다운/OOM 의심하고 heartbeat 재확인부터.
3. **2단계 분리 (cb45e46)** — 클리셰 스크립트 생성이 대사만 만들게 분리(프롬프트=3·4단계 cliche 분기, 카메라=5단계). **클리셰도 이제 3단계에서 "프롬프트 생성"을 눌러야 키프레임 진행** — 사용자 UX 확인.
4. **캐스팅 위저드 (2610277~)** — 실사용 검증: 사진 업로드→웹툰 변환, 설명 생성, 목소리 미리듣기, 확정 생성, 새로고침 복원(localStorage 임시저장).
5. **새 ElevenLabs 한국어 보이스 8종**(혁·도현·장호·태형/안나·지수·애니·하나 — 계정에 추가해둠, 커뮤니티 보이스) + 계정 라이브러리 자동 노출 — 목록·미리듣기 확인.

## 3. 미착수/보류 작업
- **re-animator MV v2 이식** — 위 2-1 검증 통과 후. 별도 레포(C:\myapps\re-animator).
- **"최근 사용 목소리"** 기능(최근 사용 그룹+pin+검색+즐겨찾기 제안) — 사용자 "고민 더" 상태, 먼저 묻기.
- **casting/<draftId>/ Blob 고아 정리** — 위저드 이탈 시 포트레이트가 Blob에 남음(사소).
- 라이브러리 정렬: 현재 "드라이브 업로드 완료본 뒤로" 유지 중 — 순수 최신순 원하면 바꿔주기로 함.

## 4. 파일 지도 (개선 작업 관련)
- `lib/types.ts`(Project/Scene/CastMember — mood·sfx·cleanVideoUrl 포함), `lib/tts.ts`(엔진 판별), `lib/emotions.ts`(감정 20종), `lib/sceneFill.ts`(프롬프트·모션 생성, cliche 분기), `lib/script.ts`+`lib/scenes.ts`(클리셰 스크립트·파서, mood), `lib/projectStore.ts`(mget 배치·페이지네이션 헬퍼).
- `app/project/[id]/Studio.tsx` — 초대형 파일, 부분 읽기 필수. 출연진(🎨 얼굴)·줄편집·감정·SFX·카메라·합성 UI.
- `app/cliche/new/ClicheNewForm.tsx` — 2화면 위저드 + localStorage 초안.
- `app/api/`: cliche/new, cast/portrait, scene/source(mood 토글·오디오 무효화), audio/scene·sfx, video/scene, compose(clean), download(kind=clean), tts/voices(계정 라이브러리 노출), library=app/library/page.tsx(페이지네이션).
- `worker/`: index.mjs(BUILD 표식·하트비트), compose.mjs(sfx amix·mood 자막 생략·clean 모드), subtitle-image.mjs.
- `config/prompts.json`(script_cliche·video_motion 4종), `config/style-profiles.json`, `config/voices.json`.

## 5. 최근 커밋(신→구)
54cbd31 불만3건+클린합성 · d644062 라이브러리 페이지네이션 · cb45e46 2단계 분리 · 8265300 타임아웃 · 31dc928 위저드 임시저장+EL 라이브러리 · abd0e17 감정 EL 전용 잠금 · d15b6b5 Typecast 복원+엔진 id 판별 · 68af8b6 cliche_calm · 0be514a MV v2 · f8510ab 기본 grok · 8fb7830 워커 표식 · 8d9fccc MV 기본화+분위기씬+포트레이트+감정 · 2610277 캐스팅 위저드 · 0985f75 저장 경합.

## 6. 첫 지시 예시
"HANDOFF-improve.md 읽었지. 배포 검증 대기 목록(§2)부터 나랑 하나씩 확인하자. MV v2 리롤 테스트 방법 알려주고, 결과 좋으면 re-animator 이식 준비해줘."
