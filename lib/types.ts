// ============================================================================
// aninews-maker21 — 도메인 타입 (골격)
// ----------------------------------------------------------------------------
// 한 "프로젝트" = 숏폼 영상 한 편. 8개 단계를 거치며, 각 단계는 독립 상태머신
// (pending → generating → generated → approved)을 가진다. 씬 단위 리롤 가능.
// 구현 디테일(필드 추가/삭제)은 진행하며 합의해서 채운다.
// ============================================================================

export type StepKind =
  | "source" // 1. RSS/URL/텍스트 입력
  | "script" // 2. Claude → 씬 배열
  | "keyframe" // 3. gpt-image-2 씬0 키프레임
  | "images" // 4. 씬별 이미지 (키프레임 레퍼런스)
  | "videos" // 5. fal image-to-video
  | "voiceover" // 6. ElevenLabs TTS (선택)
  | "compose" // 7. ffmpeg 합성 (worker)
  | "subtitle"; // 8. 번역 + 자막 번인

export const STEP_ORDER: StepKind[] = [
  "source",
  "script",
  "keyframe",
  "images",
  "videos",
  "voiceover",
  "compose",
  "subtitle",
];

export type StepStatus =
  | "pending" // 아직 생성 안 됨 / 이전 단계 미승인
  | "generating" // API 호출 중 (동기) 또는 worker 작업 진행 중 (비동기)
  | "generated" // 산출물 나옴, 검수 대기
  | "approved" // 사용자 승인, 다음 단계 진입 가능
  | "error";

// ── 씬 소스 모드 ─────────────────────────────────────────────────────────────
// 정지 이미지(4단계)·영상(5단계)을 "어디서 가져올지"의 분기. 미설정 시 "generate".
//   image:  generate  프롬프트만으로 생성(내부적으로 키프레임 레퍼런스로 일관성 유지)
//           reference 업로드한 참조 이미지 + 키프레임을 함께 레퍼런스로 img2img("이 캐릭터 살려서")
//           upload    가져온 이미지를 그대로 사용(생성 안 함)
//   video:  generate  씬 이미지 → image-to-video(현재)
//           upload    찍어온 영상을 그대로 사용(생성 안 함)
export type ImageSourceMode = "generate" | "reference" | "upload";
export type VideoSourceMode = "generate" | "upload";

// ── 씬 ──────────────────────────────────────────────────────────────────────
// script 단계가 만들고, images/videos/voiceover 단계가 채운다.
export interface Scene {
  index: number;
  narration: string; // 자막 + (기본)보이스오버 소스 (한국어). 자막 단계는 항상 이걸 쓴다.
  lines?: SceneLine[]; // [cliche] 씬 안 대사/내레이션 줄들(줄마다 화자·감정, 줄별 더빙 후 이어붙임).
  speaker?: string; // [cliche·레거시] 씬 단일 화자. lines 있으면 lines 가 우선.
  emotion?: string; // [cliche] 감정 연기 id (lib/emotions). TTS 에 오디오 태그로 과장 연기.
  voiceId?: string; // [cliche] 이 씬(대사) 전용 목소리 오버라이드. 없으면 화자(castVoices)→프로젝트 목소리.
  ttsSpeed?: number; // 이 씬 전용 보이스 속도 오버라이드. 없으면 project.voiceSpeed. (뉴스 구독 마무리 씬 1.4배 등. ElevenLabs 는 API 상한 1.2)
  ttsScript?: string; // 음성(TTS) 전용 오버라이드. 비면 narration 사용. 자막엔 영향 없음.
  narrationEn?: string; // [레거시] 영문 번역 — 신규는 dub.en.narration 사용(읽기 폴백용 유지)
  // 다국어 더빙 트랙. 언어코드(en/es/ja…) → { 번역문, 더빙 오디오 }. lib/languages.ts 참고.
  dub?: Record<string, { narration?: string; audioUrl?: string }>;
  imagePrompt: string; // gpt-image-2 프롬프트
  motion: string; // fal image-to-video 모션 지시
  durationSec: number; // 4~7, 평균 5 목표 (하드락 아님)
  status: StepStatus; // 씬 단위 리롤 시 generated 로 되돌림
  imageSource?: ImageSourceMode; // 정지 이미지 소스(기본 generate). lib/types ImageSourceMode 참고.
  referenceImageUrl?: string; // reference 모드: 업로드한 참조 이미지(키프레임과 함께 레퍼런스로)
  paletteHint?: string; // 씬별 팔레트 변주("warm sunset", "cool night"…). 비면 키프레임 팔레트 그대로.
  videoSource?: VideoSourceMode; // 영상 소스(기본 generate). upload면 videoUrl 직접 대입.
  imageUrl?: string;
  videoUrl?: string;
  videoJobId?: string; // 비동기 작업 id ("provider::..." 인코딩)
  videoModelId?: string; // 이 씬 비디오를 만든 모델 (fal/grok 등) — 비용 계산용
  audioUrl?: string; // 씬별 TTS 클립 (한국어)
  audioUrlEn?: string; // [레거시] 영어 더빙 클립 — 신규는 dub.en.audioUrl(읽기 폴백용 유지)
  ttsTimestamps?: TtsWord[]; // 자막 타이밍 (TTS 타임스탬프 기준)
  captionStyle?: string; // 자막 스타일 프리셋 id (lib/captionPresets). 비면 기본.
  mood?: boolean; // [cliche] 분위기 씬 — 대사·더빙·자막 없음(영상+효과음만). narration=분위기 묘사(생성 컨텍스트용).
  sfx?: string; // [cliche] 효과음 설명(예: "빗소리"). 생성에 사용.
  sfxUrl?: string; // [cliche] 생성된 효과음 오디오(Blob). 합성 때 목소리 밑에 믹싱.
  sfxVolume?: number; // [cliche] 효과음 볼륨(0~1, 기본 0.35). 목소리 대비.
  skipped?: boolean; // 건너뛴 씬 — 이미지/영상/음성 생성·합성·완료판정에서 제외
  // [롱폼] 호스트(마스코트) 씬 — 오프닝/연결/마무리. 없으면 일반 씬(세그먼트 본문). 롱폼은
  // 이 호스트 씬들과 세그먼트 완성본을 교차로 이어붙인다.
  hostSlot?: "opening" | "connector" | "closing";
  connectorAfter?: number; // [롱폼] connector 씬이 몇 번째 세그먼트(0-based) 뒤에 오는지.
}

export interface TtsWord {
  word: string;
  startSec: number;
  endSec: number;
}

// [cliche] 한 씬 안의 대사/내레이션 한 줄. 씬은 여러 줄을 가질 수 있고(내레이션+대사),
// 각 줄은 화자·감정이 다르며 줄별로 더빙된다. 줄 오디오들을 이어붙여 씬 오디오가 된다.
export interface SceneLine {
  text: string; // 이 줄 텍스트(자막·음성)
  speaker?: string; // 인물 이름 또는 "내레이션"
  emotion?: string; // 감정 연기 id (lib/emotions)
  audioUrl?: string; // 이 줄 더빙 오디오 (Blob)
}

// [cliche] 캐스팅 단계 산출물 — 인물 한 명. 새 프로젝트 위저드(캐스팅 화면)에서 만들고,
// cast(이름 목록)·castVoices(이름→목소리)는 여기서 파생·동기화되는 미러다(기존 경로 무회귀).
export interface CastMember {
  name: string; // 인물 이름(화자 키 — cast/castVoices/씬 speaker 와 동일 문자열)
  archetype?: string; // 클리셰 성격(예: "츤데레남") — 스크립트·포트레이트 생성에 사용
  faceSource?: "upload" | "generate"; // 얼굴 출처. upload=사진 업로드→스타일화 변환
  faceUploadUrl?: string; // 업로드 원본 사진(변환 입력). 재변환용으로 보관
  faceDesc?: string; // 생성 모드 외모 설명(예: "은발 단발, 안경")
  portraitUrl?: string; // 확정 포트레이트(캐릭터 시트) — 키프레임·씬 생성 참조로 주입
  voiceId?: string; // 이 인물 목소리(castVoices 미러)
}

// ── StepChat: 단계별 Claude 미세조정 창 ──────────────────────────────────────
export interface StepChatTurn {
  role: "user" | "assistant";
  text: string;
  ts: number;
}

// ── 단계 상태 ────────────────────────────────────────────────────────────────
export interface StepState {
  kind: StepKind;
  status: StepStatus;
  jobId?: string; // fal/compose 등 비동기 worker 작업 id
  params: Record<string, unknown>; // StepChat 이 갱신하는 단계별 파라미터
  chat: StepChatTurn[]; // 이 단계 전용 대화 로그
  error?: string;
  updatedAt: number;
}

// ── 자막 설정 (프로젝트 일괄) ────────────────────────────────────────────────
export interface SubtitleSettings {
  font: "sans" | "serif";
  weight: "regular" | "bold";
  size: "small" | "medium" | "large";
  position: "top" | "one-quarter" | "one-third" | "center" | "two-thirds" | "three-quarters" | "bottom";
  align: "center" | "left";
  box: "dark" | "light"; // dark=검은 박스+흰 글씨, light=흰 박스+검은 글씨
  lang: "ko" | "en" | "both"; // 자막 언어 (영어는 번역 생성 필요)
}

export const DEFAULT_SUBTITLE: SubtitleSettings = {
  font: "sans",
  weight: "regular",
  size: "small",
  position: "three-quarters",
  align: "center",
  box: "dark",
  lang: "ko",
};

// ── 워터마크 (최종 출력에 새김) ──────────────────────────────────────────────
export interface Watermark {
  text: string; // 글자 워터마크. imageUrl 이 있으면 비어 있어도 된다(그림만 새김).
  position: "tl" | "tr" | "bl" | "br"; // 좌상 / 우상 / 좌하 / 우하
  imageUrl?: string; // 업로드한 그림 워터마크(로고 등). 있으면 글자 대신 이걸 새긴다.
  imageScale?: number; // 그림 크기 = 짧은 변 대비 비율(0.04~0.4, 기본 0.12).
  imageOpacity?: number; // 그림 투명도(0.1~1, 기본 1=원본). PNG 자체 알파는 그대로 곱해진다.
}

// ── [롱폼] 열린 고리 오프닝 ───────────────────────────────────────────────────
// 롱폼 오프닝은 "답을 못 들었다"는 열린 고리로 끝까지 붙잡는 게 목적. 자동 생성 결과.
export interface LongformOpening {
  script: string[]; // 오프닝 나레이션 문장들(4~6, 낭독 15~25초). 사용자 수정 가능.
  openLoop: {
    question: string; // 오프닝이 여는 질문
    closesAt: string; // 닫히는 챕터(번호 또는 "마지막 챕터")
    closingLineHint: string; // 닫을 때 쓸 문장 힌트
  };
  chapterBridges: { chapter: number; role: string; bridgeHint: string }[]; // 챕터별 고리 연결 가이드
  selfCheck: {
    firstWordDrawer?: string; // 인물 | 종목 | 지갑 | 국가
    roadmapLeak?: boolean; // 목차/로드맵 노출 여부(true면 재생성 대상)
    midpointExitCost?: string; // 중간에 끄면 아쉬운 것
  };
  generatedAt: number;
}

// ── [롱폼] 모듈 1 — 제목 패키지 ───────────────────────────────────────────────
// 제목 원칙은 쇼츠와 같은 파일 하나(config/title-principles.json)다. 예전의 "검색 5원칙"은
// 롱폼이 검색 지면이라는 전제로 만든 것인데 전제가 틀렸고, "○○ 관련주" 껍데기만 찍어냈다.
export interface LongformTitleCandidate {
  title: string;
  thumbnailText: string; // 제목과 비중복 괴리 — 모듈 5가 그대로 쓴다.
  covers?: number[]; // 이 제목을 뒷받침하는 구성 편 번호(1-based).
  coverNote?: string; // 한 편만 뒷받침할 때의 안내. ★탈락시키지 않는다 — 다 담으라고 밀면 설명문이 된다.
  principlesCheck: Record<string, boolean>; // 제목 6원칙 통과 여부
  screening: Record<string, boolean>; // 검수 질문
  violations?: string[]; // 코드 검사(시점 표현·30자·묶음가치·커버 범위)로 잡힌 것
}

// 운영자가 직접 쓴 제목을 원칙으로 검증한 결과(생성 후보와 별개 — 원문을 존중해 진단만).
export interface LongformTitleReview {
  title: string; // 검증한 원문
  verdict: "pass" | "revise";
  principlesCheck: Record<string, boolean>;
  screening: Record<string, boolean>;
  violations: string[]; // 코드 검사(시점 표현·묶음 표시어·앞 30자·썸네일 판독)
  issues: string[]; // 모델 진단
  strengths: string[];
  primaryKeyword: string;
  keywordRationale: string;
  alternatives: { title: string; why: string }[];
  thumbnailText: string;
  titlePromise: string;
  summary: string;
  reviewedAt: number;
}

export interface LongformTitlePackage {
  keywordCandidates: string[]; // 검색어 후보 5~8
  primaryKeyword: string;
  secondaryKeyword: string;
  keywordRationale: string;
  candidates: LongformTitleCandidate[];
  rejected: { title: string; reason: string }[];
  recommendation: string; // 최종 추천 1개 + 이유 한 줄
  recommendedIndex: number;
  titlePromise: string; // 추천 제목이 약속한 괴리 한 줄 — 모듈 2~5의 기준점
  // 사용자 확정(여기서 멈추고 확정을 받은 뒤에야 모듈 2~4가 돈다)
  finalTitle?: string;
  finalThumbnailText?: string;
  confirmedAt?: number;
  // 직접 쓴 제목 검증 결과(마지막 1건). 생성 후보와 무관하게 남는다.
  review?: LongformTitleReview;
  generatedAt: number;
}

// ── [롱폼] 모듈 3 — 브리지(세그먼트 사이 1개) ─────────────────────────────────
export interface LongformBridge {
  afterSegment: number; // 이 전역 세그먼트 인덱스(0-based) 뒤에 놓인다.
  emphasis: string; // 방점 — 직전 세그먼트의 고리를 반만 닫는 한 문장
  elevation: string; // 승격 — title_promise 의 큰 고리에 연결
  opening: string; // 개방 — 다음 세그먼트의 질문을 연다(답 선공개 금지)
  isMidpointReopen: boolean; // 중간점 고리 환기(영상당 1회만)
  imagePrompt?: string; // 진행자 씬 비주얼(영문)
}

// ── [롱폼] 모듈 2~4 — 대본 패키지(오프닝·세그먼트 순서·브리지·엔딩) ──────────
export interface LongformScriptPackage {
  titleUsed: string;
  titlePromise: string;
  segmentOrder: { order: number; segmentId?: string; title: string; rationale: string }[];
  orderNote?: string; // 사용자 지정 순서에 대한 유지율 우려(한 번만)
  opening: {
    blockAHook: string; // 제목 호응 훅(10초 이내, 2문장 이내)
    blockBRoadmapLanding: string; // 로드맵 + 착지(15초 이내)
    estSeconds: number;
    imagePromptA?: string;
    imagePromptB?: string;
  };
  bridges: LongformBridge[];
  ending: {
    partAClose: string; // 고리 닫기 — 전체에서 유일한 폐쇄 지점
    partBLanding: string; // 계좌 착지
    partCStandard: string; // 구독 전환(롱폼 표준 문구)
    endscreenVideo: string; // 엔드스크린 추천 대상(구성 쇼츠 중 최강 실적작)
    estSeconds: number;
    imagePromptA?: string;
    imagePromptB?: string;
    imagePromptC?: string;
  };
  screening: Record<string, string>; // 제목호응·고리일치·조기폐쇄·25초규칙·척추검수·20초검수
  generatedAt: number;
}

// ── [롱폼] 모듈 5 — 썸네일 ────────────────────────────────────────────────────
export interface LongformThumbnailVariant {
  composition: string; // 구도 변형 설명(한국어)
  prompt: string; // 이미지 생성 프롬프트(영문, 텍스트 없는 이미지)
  imageUrl?: string; // 글씨 없는 원본
  fileUrl?: string; // 글씨 얹은 시안(1280x720 jpg)
  previewUrl?: string; // 168px 축소 검증본
  strokePx?: number; // 168px 기준 글자 획 두께 추정(2px 미만이면 재합성)
}

export interface LongformThumbnailPackage {
  textUsed: string; // 제목 단계에서 정한 썸네일 문구(직접 고쳤으면 그 값)
  variants: LongformThumbnailVariant[];
  selected?: string; // 사용자 확정 파일 URL
  screening: Record<string, string>;
  generatedAt: number;
  // ★ 화면에서 지정한 설정을 그대로 담아 둔다 — 다시 만들 때 또 고르게 하지 않는다
  // (사용자 지정 2026-08-01).
  settings?: {
    styleProfileId?: string;
    quality?: "low" | "medium" | "high";
    chipIds?: string[]; // 켜 뒀던 칩
    extra?: string; // 직접 쓴 그림 지시
    referenceImageUrl?: string; // 업로드한 참조 이미지
  };
}

// ── [롱폼] 섹션 — 2~3 세그먼트씩 묶어 "부분 합성"한 중간본 ─────────────────────
// 10편+ 롱폼을 한 워커 잡에서 몰아 합성하면 디스크·메모리가 위험(각 잡이 세그먼트를
// 전부 다운로드). 그래서 세그먼트를 2~3개씩 섹션으로 나눠 섹션마다 별도 합성 잡으로
// 굽고(그 잡은 2~3편만 만짐·임시폴더는 잡마다 새로 생겼다 삭제), 최종 join 은 섹션
// 영상들만 이어붙인다 → 한 잡이 잡는 리소스가 총 편수와 무관하게 항상 고정.
//   · segmentIds = sourceProjectIds 의 순서 유지 부분집합.
//   · videoUrl = 부분 합성 결과(Blob). 최종 join 이 이걸 concat.
//   · 진행자 연결 씬: 섹션 "내부"(세그 사이) 연결은 그 섹션 합성에, 섹션 "경계" 연결은
//     최종 join 에 넣는다(경계 = 섹션 마지막 세그 뒤).
export interface LongformSection {
  id: string;
  segmentIds: string[]; // 이 섹션 세그먼트들(순서대로). sourceProjectIds 의 부분집합.
  videoUrl?: string; // 부분 합성 결과(Blob) — 최종 join 대상.
  videoUrlBackup?: string; // 낡아서 다시 굽기 전의 직전 결과(보존용 — 삭제 대신 백업).
  status?: "pending" | "generating" | "generated" | "error";
  jobId?: string; // 이 섹션 합성 잡 id(진행 추적).
  error?: string;
  updatedAt?: number;
}

// ── [확장판] 사실 카드 — 검색에서 대본으로 건너가는 유일한 다리 ────────────────
// 본문은 카드에 없는 숫자·고유명사를 새로 들여올 수 없다(팩트 대조가 기계로 잡는다).
// 같은 소재의 쇼츠·확장판이 카드를 공유할 수 있게 프로젝트에 통째로 저장한다.
export interface FactCard {
  id: string; // "F-001"
  fact: string; // 한 문장 사실
  grade: string; // 공식 | 보도 | 관찰 | 추측 (config/elongated-config.json grades)
  sourceUrl: string;
  sourceName: string;
  sourceDate: string; // YYYY-MM-DD (출처가 말하는 시점)
  fetchedAt: string; // YYYY-MM-DD (우리가 가져온 날)
  expires: boolean; // 가격·시세류 — 게시 전 재확인 필요
}

// 챕터 사이에 끼우는 "덧붙일 대목". 유형은 config block_types.
// 설계(1단계)가 need·query 까지 적고, 사실 찾기(2단계)가 factIds·missing·searchedAt 을 채운다.
export interface ElongatedBlock {
  type: string; // 근거 심화 | 사례 | 반론 | 배경
  need: string; // 이 대목이 요구하는 내용(설계가 적는다)
  query?: string; // 근거를 찾을 때 쓸 검색어(설계가 적는다)
  factIds: string[]; // 붙은 사실 카드
  missing?: string; // 검색으로 못 채운 것 — 있으면 "부족한 사실"
  searchedAt?: number; // 사실 찾기를 돌린 시각. 없으면 아직 안 찾은 대목.
  enabled: boolean; // 사용자가 끄면 본문에서 제외
}

export interface ElongatedChapter {
  index: number; // 1-based
  title: string;
  sourceSceneIndexes: number[]; // 이 챕터가 품는 원본 씬(0-based)
  role: string; // 열린 고리에서 이 챕터가 하는 일
  blocks: ElongatedBlock[];
  body?: string; // 본문(생성 후). 문장 뒤 카드 주석 포함.
  bodyGeneratedAt?: number;
}

export interface ElongatedPlan {
  openLoop: {
    question: string; // 원본 ①씬이 연 질문 — 롱폼에서도 이걸 연다
    closesAtChapter: number; // 닫는 챕터 번호
    closingLineHint: string;
  };
  chapters: ElongatedChapter[];
  approvedAt?: number; // 사용자 승인 — 이게 없으면 본문 생성 잠김(동의 게이트)
  generatedAt: number;
}

// 팩트 대조 결과 — 판정은 3종뿐. 의견성 지적을 담지 않는다.
export type FactMatchVerdict = "카드에 있음" | "카드에 없음" | "카드와 다름";
export interface ElongatedFactCheckItem {
  chapter: number;
  sentence: string;
  token: string; // 문제의 숫자·날짜·고유명사·인용
  verdict: FactMatchVerdict;
  cardId?: string;
}
export interface ElongatedFactCheck {
  items: ElongatedFactCheckItem[];
  checkedAt: number;
}

// 닫힌 채점표 — 항목은 lib/elongatedScore.ts 의 고정 목록이 전부다(추가 금지).
export interface ElongatedScore {
  items: { no: number; label: string; pass: boolean; evidence: string }[];
  summary: string; // 전 항목 통과면 "통과" 한 단어
  scoredAt: number;
}

// ── [확장판] 트랙 — 검증된 쇼츠 한 편을 N배로 늘린 단일 롱폼 ──────────────────
// 컴필레이션(여러 쇼츠를 이어붙임, sourceProjectIds)과는 별개 트랙. 이 필드가 있으면
// 확장판이다(롱폼 탭의 확장판 목록 · 스튜디오 분기 기준).
export interface ElongatedTrack {
  sourceProjectId: string; // 늘릴 원본 쇼츠 — 읽기 전용으로만 쓴다
  sourceTitle: string; // 스냅샷(원본이 지워져도 화면이 안 깨지게)
  sourceSeconds: number; // 원본 낭독 길이(초) — 배수 계산 기준
  targetSec: number; // 목표 길이(초)
  presetName?: string; // 고른 프리셋 이름(직접 입력이면 없음)
  blockTypes: string[]; // 켜 둔 덧붙일 대목 유형
  plan?: ElongatedPlan;
  facts: FactCard[];
  factCheck?: ElongatedFactCheck;
  score?: ElongatedScore;
  createdAt: number;
  updatedAt: number;
}

// ── 프로젝트 ──────────────────────────────────────────────────────────────────
export interface Project {
  id: string;
  title: string;
  // 콘텐츠 모드. "news"(기본)=뉴스 숏폼, "cliche"=연애 클리셰(ani-cliché 탭).
  // cliche 는 같은 파이프라인을 쓰되 스크립트(대사)·스타일·카메라·목소리를 로맨스로 프리셋.
  mode?: "news" | "cliche";
  // 영상 포맷. "short"(기본·없으면 이걸로)=세로 9:16, "long"=가로 16:9(롱폼).
  // 이미지 크기·워커 해상도·fal 비율·UI 종횡비의 단일 원천(lib/format.ts).
  format?: "short" | "long";
  // [롱폼] 이 롱폼을 이어붙인 소재 숏폼(세그먼트)들의 프로젝트 id — 순서대로. 출처·재씨딩용.
  // 각 세그먼트는 16:9로 재합성된(구독 마무리씬 제외) 프로젝트이며, 그 finalVideoUrl 을 이어붙인다.
  sourceProjectIds?: string[];
  // [롱폼] 세그먼트 사이/뒤에 1초씩 끼우는 아이캐치(송곳니 안경 미소녀 + 구독 버튼) 이미지.
  // 롱폼당 1장 생성해 매 경계에 재사용. 구독 마무리씬을 대체(반복 노출로 구독 유도).
  eyecatchUrl?: string;
  // [롱폼-세그먼트] 이 프로젝트가 어떤 롱폼의 세그먼트/진행자인지(역참조). 라이브러리에서 롱폼
  // 이름 폴더로 묶는 키. 이 필드가 있는 "새" 항목만 폴더로 렌더(기존 항목은 평면 유지).
  longformId?: string;
  // [롱폼] 진행자(호스트) 프로젝트 id — 오프닝·연결·마무리 호스트 씬을 담은 별도 프로젝트.
  // Studio 에서 세그먼트처럼 씬별 편집. 합성 때 슬롯대로 세그먼트와 교차.
  hostProjectId?: string;
  // [롱폼] 열린 고리(Open Loop) 오프닝 — 모듈 2가 만든 오프닝을 구조 검수(longformReview)가
  // 읽을 수 있게 미러링한 형태. 원천은 longformScript.
  opening?: LongformOpening;
  // [롱폼] 모듈 1 — 제목 패키지(검색어·후보·추천·title_promise·사용자 확정).
  longformTitle?: LongformTitlePackage;
  // [롱폼] 모듈 2~4 — 대본 패키지(오프닝 2블록·세그먼트 순서·브리지·엔딩 3파트 + 검수).
  // 진행자 프로젝트 씬(hostSlot)은 이 패키지에서 만들어진다.
  longformScript?: LongformScriptPackage;
  // [롱폼] 모듈 5 — 썸네일 시안 3종 + 168px 검증본.
  thumbnail?: LongformThumbnailPackage;
  // [롱폼] 섹션 — 세그먼트를 2~3개씩 묶은 부분 합성 단위. 있으면 합성을 섹션별 잡으로 쪼갠 뒤
  // 최종 join(섹션 영상 이어붙이기)을 한다. 없으면 기존 단일 runLongformConcat 경로.
  sections?: LongformSection[];
  // [확장판] 쇼츠 한 편을 N배로 늘린 롱폼. 이 필드가 있으면 확장판(컴필레이션과 별개 트랙).
  // 세그먼트가 없으므로 sourceProjectIds 는 비어 있고, 챕터 본문이 이 프로젝트의 씬이 된다.
  elongated?: ElongatedTrack;
  cast?: string[]; // [cliche] 등장 인물 이름들(화자 = 이 이름 또는 "내레이션"). 목소리·씬 화자에 사용.
  castMembers?: CastMember[]; // [cliche] 캐스팅 단계 산출물(얼굴·목소리 포함). cast/castVoices 의 원천.
  styleProfileId: string; // config/style-profiles.json 의 id
  styleBible: string; // 키프레임에서 확정 → 전 씬 공유되는 스타일 규약
  keyframeUrl?: string;
  keyframeReferenceUrl?: string; // 키프레임 생성 시 참조할 업로드 이미지(있으면 img2img로 후보 생성)
  scenes: Scene[];
  steps: Record<StepKind, StepState>;
  factCheckChat?: StepChatTurn[]; // 스크립트 팩트체크 전용 대화 로그(2단계, 스크립트 다듬기와 별개). 없으면 [].
  ttsEnabled: boolean;
  ttsProvider?: "elevenlabs" | "typecast"; // 보이스오버 엔진(프로젝트별). 없으면 env TTS_PROVIDER.
  voiceId?: string; // 보이스오버 목소리(프로젝트당 하나). config/voices.json 의 voice id. 없으면 env 기본.
  castVoices?: Record<string, string>; // [cliche] 화자(speaker "A"/"B"…)별 목소리. 없으면 voiceId 폴백.
  voiceSpeed?: number; // 보이스오버 속도 배율(1.0 기본 / 1.2 빠르게). 음성 생성 시 적용.
  videoModelId: string; // config/video-models.json (기본 Seedance)
  videoCommonPrompt?: string; // 5단계 영상 생성에 전 씬 공통으로 덧붙는 지시(영문/한글). 씬 motion 뒤, 톤 가이드 앞에 들어감.
  subtitle?: SubtitleSettings; // 자막 디자인(일괄). 없으면 DEFAULT_SUBTITLE.
  watermark?: Watermark; // 최종 영상에 새길 워터마크(텍스트+위치). 없으면 안 새김.
  credit?: string; // 제작 크레딧 이름 — 마지막 2씬에 "제작 : {credit}"을 워터마크 옆에 크게.
  userPrompt?: string; // 소스 단계에서 입력한 의도("어떤 식으로 만들까요?") — 스크립트 생성에 주입.
  finalVideoUrl?: string;
  cleanVideoUrl?: string; // "영상만" 합성본(보이스·자막·효과음·워터마크 제외, 타이밍은 동일). 소재용 다운로드.
  lang?: string; // 이 프로젝트 나레이션 언어. 원본(한국어)은 비움, 다국어판은 en/es/ja/vi.
  sourceProjectId?: string; // 다국어판이면 원본 프로젝트 id (라이브러리 그룹·검색용).
  ownerEmail?: string; // 만든 사람(로그인 이메일). 비면 관리자(ADMIN_EMAIL) 소유로 본다.
  // (드라이브 업로드 관련 필드 category·uploadKeyword·driveLink·driveFileName·
  //  driveUploadedUrl 은 기능과 함께 제거됨. 옛 프로젝트에 남아 있어도 읽는 곳이 없다.)
  createdAt: number;
  updatedAt: number;
}

// ── 시뮬 제조기 (연애 미니게임) ───────────────────────────────────────────────
// ani-cliché 위에 얹는 미니 게임. castMembers 를 상대 캐릭터로 재사용하고,
// 친밀도(0~100) 마일스톤에서 완성된 클리셰 영상을 컷씬으로 재생한다.
// 원본 프로젝트가 수정·삭제돼도 게임이 안 깨지게 포트레이트·영상 URL 은
// 게임 정의에 스냅샷으로 복사해 둔다(참조 아님).

export interface SimCutscene {
  at: number; // 친밀도 도달점 (25 | 50 | 75)
  projectId: string; // 원본 클리셰 프로젝트(재스냅샷용 참조)
  videoUrl: string; // 스냅샷 — 지정 시점의 cleanVideoUrl ?? finalVideoUrl
  title?: string; // 원본 프로젝트 제목(제조기 UI 표시용)
}

export interface SimTarget {
  name: string; // CastMember.name (화자 키와 동일 문자열)
  archetype?: string; // 스냅샷 — 페르소나 재생성용
  portraitUrl?: string; // 스냅샷 — 플레이 화면 아바타(기본 얼굴 폴백)
  voiceId?: string; // 스냅샷 — (후속) 대사 TTS 옵션용
  persona: string; // Claude 시스템 프롬프트 — 성격·말투·좋아하는/싫어하는 반응. 수정 가능.
  relationship?: string; // 주인공(플레이어)과 이 상대의 관계·만남의 계기 — 오프닝·대화 프롬프트에 주입.
  faces?: Record<string, string>; // 표정 얼굴 세트 (neutral/smile/frown/blush/sulk → URL). lib/simFaces.
  cutscenes: SimCutscene[]; // 마일스톤 컷씬 (없어도 플레이 가능)
}

// 공략하는 주인공(플레이어) 캐릭터 — 게임당 하나. 상대가 '누군지'를 알고 반응하게 한다.
export interface SimProtagonist {
  name: string;
  persona: string; // 한 줄~몇 줄 성격·설정
}

// 시나리오 설계(로맨스 플로우 Step3~7) — 캐릭터(Step1=아키타입)·관계(Step2=relationship)는
// 이미 target 에 있고, 아래는 게임 전체의 서사 톤. 전부 선택(비면 자유).
export interface SimScenario {
  setting?: string; // Step3 시간·서사 배경 (현재진행형/첫사랑 재회형/오래된 인연의 발전형)
  triggers?: string[]; // Step4 감정 트리거 태그 (jealousy/misunderstanding/rescue/triangle …) — 상황 우선 발동
  emotionCurve?: string; // Step5 감정 곡선 (완만한 설렘형/롤러코스터형/급반전형)
  toneStyle?: string; // Step6 대사·말투 스타일 (직진형/밀당형/존댓말→반말 전환형)
  ending?: string; // Step7 갈등-해소·엔딩 톤 (신뢰 회복형 해피엔딩/자기희생 후 재결합/여운 남는 열린 결말)
}

export interface SimGame {
  id: string;
  title: string;
  sourceProjectId: string; // castMembers 를 가져온 클리셰 프로젝트
  protagonist?: SimProtagonist; // 주인공(플레이어) 설정 — 없으면 기존처럼 익명 플레이어
  scenario?: SimScenario; // 시나리오 설계(Step3~7) — 서사 톤·감정 트리거
  targets: SimTarget[]; // 공략 상대들
  ownerEmail?: string; // 만든 사람(로그인 이메일)
  createdAt: number;
  updatedAt: number;
}

// 관계 기억 한 조각 — type 은 config/sim-memory-ontology.json 의 타입 id.
export interface SimMemory {
  type: string; // "fact" | "preference" | "sensitive" | "promise" | "moment" | "bond"
  text: string; // 기억 내용 (예: "강아지 '콩이'를 키운다")
  key?: string; // 갱신 키 — 같은 type+key 면 덮어쓴다(예: "반려동물")
  turn: number; // 이 기억이 생긴 대략의 턴
}

export interface SimTurn {
  role: "user" | "assistant";
  text: string;
  likeDelta?: number; // assistant 턴 — 좋음 증감
  dislikeDelta?: number; // assistant 턴 — 싫음 증감. 한 말이 좋음·싫음 동시 상승 가능(느끼함·지뢰).
  sulking?: boolean; // assistant 턴 직후 삐짐 상태(UI 스냅샷)
  situationId?: string; // 이 턴에 발동된 상황 이벤트 id (simSituations)
  ts: number;
}

export interface SimPlay {
  id: string;
  gameId: string;
  targetName: string; // 공략 중인 상대 (SimTarget.name)
  like: number; // 좋음 0~100 (쌓인 호감 — 승리 지표)
  dislike: number; // 싫음 0~100 (쌓인 거부감·서운함). 높으면 삐짐, 최대면 파탄.
  sulking: boolean; // 삐짐 상태 — 좋음이 안 오르고, 정확한 사과로 싫음을 풀어야만 벗어난다.
  sulkReason?: string; // 삐진 이유(내부) — 사과가 이걸 정확히 짚어야 풀린다.
  memory: SimMemory[]; // 관계 기억 온톨로지 — 잘려나간 옛 대화에서 뽑은 '영구 기억'. 매 턴 상대에게 주입돼 "옛날 얘기를 기억하는 연인"을 만든다. config/sim-memory-ontology.json 참고.
  turns: SimTurn[];
  milestonesSeen: number[]; // 이미 재생한 컷씬 도달점 [25, 50, ...]
  situationsUsed: string[]; // 이미 발동한 상황 id (중복 방지)
  nextSituationAtTurn: number; // 다음 상황을 발동할 assistant 턴 번호(코드가 주사위)
  status: "playing" | "won" | "lost";
  endedReason?: string; // 엔딩 사유(고백 성공/거절 등) — 엔딩 화면 표시용
  ownerEmail?: string;
  createdAt: number;
  updatedAt: number;
}

// ── AI 자동극장 (관전 모드) ──────────────────────────────────────────────────
// 2~3명의 AI 인물을 '상황'에 던져 넣고 '다음' 버튼으로 한 턴씩 자동 대화(연애·싸움)를
// 시켜 관전한다. 인물 사이 감정은 '방향성 2축' — from 이 to 에게 느끼는 좋음/싫음.
export interface TheaterCast {
  name: string;
  archetype?: string;
  persona: string; // 시스템 프롬프트용 성격·말투
  portraitUrl?: string;
  faces?: Record<string, string>; // 표정 얼굴(있으면)
}

export interface TheaterTurn {
  speaker: string; // 이번에 말한 인물 이름
  text: string;
  situation?: string; // 이 턴 직전 사용자가 던진 난입 상황(있으면)
  ts: number;
}

// 방향성 감정: from 이 to 에게 느끼는 좋음/싫음(0~100).
export interface TheaterFeeling {
  from: string;
  to: string;
  like: number;
  dislike: number;
}

export interface SimTheater {
  id: string;
  title: string;
  situation: string; // 시작 상황(무대 설정)
  cast: TheaterCast[]; // 2~3명
  turns: TheaterTurn[];
  feelings: TheaterFeeling[]; // 방향쌍별 감정 (N명 → N*(N-1)개)
  nextSpeakerIdx: number; // 라운드로빈 다음 화자 인덱스
  ownerEmail?: string;
  createdAt: number;
  updatedAt: number;
}

// ── 비용 추적 (cardnews cost.ts 확장: +fal +elevenlabs) ──────────────────────
export interface CostEntry {
  id: string;
  projectId?: string;
  vendor:
    | "anthropic"
    | "openai"
    | "fal"
    | "grok"
    | "kling"
    | "minimax"
    | "elevenlabs"
    | "typecast";
  model: string;
  costUsd: number;
  createdAt: number;
  meta?: Record<string, unknown>;
}
