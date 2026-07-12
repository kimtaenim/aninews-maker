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
  position: "top" | "one-third" | "center" | "two-thirds" | "three-quarters" | "bottom";
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
  text: string;
  position: "tl" | "tr" | "bl" | "br"; // 좌상 / 우상 / 좌하 / 우하
}

// ── 프로젝트 ──────────────────────────────────────────────────────────────────
export interface Project {
  id: string;
  title: string;
  // 콘텐츠 모드. "news"(기본)=뉴스 숏폼, "cliche"=연애 클리셰(ani-cliché 탭).
  // cliche 는 같은 파이프라인을 쓰되 스크립트(대사)·스타일·카메라·목소리를 로맨스로 프리셋.
  mode?: "news" | "cliche";
  cast?: string[]; // [cliche] 등장 인물 이름들(화자 = 이 이름 또는 "내레이션"). 목소리·씬 화자에 사용.
  castMembers?: CastMember[]; // [cliche] 캐스팅 단계 산출물(얼굴·목소리 포함). cast/castVoices 의 원천.
  styleProfileId: string; // config/style-profiles.json 의 id
  styleBible: string; // 키프레임에서 확정 → 전 씬 공유되는 스타일 규약
  keyframeUrl?: string;
  keyframeReferenceUrl?: string; // 키프레임 생성 시 참조할 업로드 이미지(있으면 img2img로 후보 생성)
  scenes: Scene[];
  steps: Record<StepKind, StepState>;
  ttsEnabled: boolean;
  ttsProvider?: "elevenlabs" | "typecast"; // 보이스오버 엔진(프로젝트별). 없으면 env TTS_PROVIDER.
  voiceId?: string; // 보이스오버 목소리(프로젝트당 하나). config/voices.json 의 voice id. 없으면 env 기본.
  castVoices?: Record<string, string>; // [cliche] 화자(speaker "A"/"B"…)별 목소리. 없으면 voiceId 폴백.
  voiceSpeed?: number; // 보이스오버 속도 배율(1.0 기본 / 1.2 빠르게). 음성 생성 시 적용.
  videoModelId: string; // config/video-models.json (기본 Seedance)
  subtitle?: SubtitleSettings; // 자막 디자인(일괄). 없으면 DEFAULT_SUBTITLE.
  watermark?: Watermark; // 최종 영상에 새길 워터마크(텍스트+위치). 없으면 안 새김.
  credit?: string; // 제작 크레딧 이름 — 마지막 2씬에 "제작 : {credit}"을 워터마크 옆에 크게.
  userPrompt?: string; // 소스 단계에서 입력한 의도("어떤 식으로 만들까요?") — 스크립트 생성에 주입.
  finalVideoUrl?: string;
  lang?: string; // 이 프로젝트 나레이션 언어. 원본(한국어)은 비움, 다국어판은 en/es/ja/vi.
  sourceProjectId?: string; // 다국어판이면 원본 프로젝트 id (라이브러리 그룹·검색용).
  ownerEmail?: string; // 만든 사람(로그인 이메일). 비면 관리자(ADMIN_EMAIL) 소유로 본다.
  category?: string; // [레거시] 업로드 파일명용 분야. 지금은 uploadKeyword 사용.
  uploadKeyword?: string; // 업로드 파일명용 영어 한 단어 키워드(Claude 가 내용 보고 작명, 첫 업로드 시 저장).
  driveLink?: string; // Drive 업로드된 파일 보기 링크.
  driveFileName?: string; // 마지막 업로드 파일명(날짜-번호-분야-언어). UI 표시·번호 확인용.
  driveUploadedUrl?: string; // 업로드 당시의 finalVideoUrl — 이게 현재 값과 다르면(재합성) 다시 업로드 버튼.
  createdAt: number;
  updatedAt: number;
}

// ── 비용 추적 (cardnews cost.ts 확장: +fal +elevenlabs) ──────────────────────
export interface CostEntry {
  id: string;
  projectId?: string;
  vendor: "anthropic" | "openai" | "fal" | "grok" | "elevenlabs" | "typecast";
  model: string;
  costUsd: number;
  createdAt: number;
  meta?: Record<string, unknown>;
}
