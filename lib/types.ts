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

// ── 씬 ──────────────────────────────────────────────────────────────────────
// script 단계가 만들고, images/videos/voiceover 단계가 채운다.
export interface Scene {
  index: number;
  narration: string; // 보이스오버 대본 + 자막 소스 (한국어)
  narrationEn?: string; // 영문 자막용 번역 (선택)
  imagePrompt: string; // gpt-image-2 프롬프트
  motion: string; // fal image-to-video 모션 지시
  durationSec: number; // 4~7, 평균 5 목표 (하드락 아님)
  status: StepStatus; // 씬 단위 리롤 시 generated 로 되돌림
  imageUrl?: string;
  videoUrl?: string;
  videoJobId?: string; // 비동기 작업 id ("provider::..." 인코딩)
  videoModelId?: string; // 이 씬 비디오를 만든 모델 (fal/grok 등) — 비용 계산용
  audioUrl?: string; // 씬별 TTS 클립 (한국어)
  audioUrlEn?: string; // 영어 더빙 클립 (다국어판)
  ttsTimestamps?: TtsWord[]; // 자막 타이밍 (TTS 타임스탬프 기준)
}

export interface TtsWord {
  word: string;
  startSec: number;
  endSec: number;
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
  position: "bottom" | "top";
  align: "center" | "left";
  box: "dark" | "light"; // dark=검은 박스+흰 글씨, light=흰 박스+검은 글씨
  lang: "ko" | "en" | "both"; // 자막 언어 (영어는 번역 생성 필요)
}

export const DEFAULT_SUBTITLE: SubtitleSettings = {
  font: "sans",
  weight: "regular",
  size: "medium",
  position: "bottom",
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
  styleProfileId: string; // config/style-profiles.json 의 id
  styleBible: string; // 키프레임에서 확정 → 전 씬 공유되는 스타일 규약
  keyframeUrl?: string;
  scenes: Scene[];
  steps: Record<StepKind, StepState>;
  ttsEnabled: boolean;
  videoModelId: string; // config/video-models.json (기본 Seedance)
  subtitle?: SubtitleSettings; // 자막 디자인(일괄). 없으면 DEFAULT_SUBTITLE.
  watermark?: Watermark; // 최종 영상에 새길 워터마크(텍스트+위치). 없으면 안 새김.
  userPrompt?: string; // 소스 단계에서 입력한 의도("어떤 식으로 만들까요?") — 스크립트 생성에 주입.
  finalVideoUrl?: string;
  createdAt: number;
  updatedAt: number;
}

// ── 비용 추적 (cardnews cost.ts 확장: +fal +elevenlabs) ──────────────────────
export interface CostEntry {
  id: string;
  projectId?: string;
  vendor: "anthropic" | "openai" | "fal" | "grok" | "elevenlabs";
  model: string;
  costUsd: number;
  createdAt: number;
  meta?: Record<string, unknown>;
}
