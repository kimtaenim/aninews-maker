// ============================================================================
// [확장판] 검증된 쇼츠 한 편을 N배 길이의 단일 롱폼으로 늘리는 트랙.
// ----------------------------------------------------------------------------
// 컴필레이션(여러 쇼츠를 이어붙이는 기존 롱폼, lib/longform.ts)과 별개다.
//  · 원본 쇼츠는 읽기 전용 — 확정된 대본은 손대지 않는다.
//  · 확장판 = 챕터를 가진 단일 16:9 프로젝트. 세그먼트가 없으므로 sourceProjectIds 는 비고,
//    렌더는 챕터 본문을 씬으로 펼쳐 기존 파이프라인을 그대로 탄다(별도 렌더 경로 없음).
//  · 숫자(프리셋·허용오차·유형)는 config/elongated-config.json 이 단일 원천.
//    글자 수 한도는 lib/longformScreening.ts 의 상수에서 파생한다 — 한도를 두 벌 만들지 않는다.
// ============================================================================

import { randomUUID } from "crypto";
import raw from "../config/elongated-config.json";
import { CHARS_PER_SEC, speakSeconds } from "./longformScreening";
import { DURATION_MAX, DURATION_MIN } from "./scenes";
import {
  ELEVENLABS_USD_PER_CHAR,
  FAL_VIDEO_DEFAULT_USD,
  KRW_PER_USD,
  OPENAI_IMAGE_PRICING,
} from "./cost";
import { estimateCost, type CostRates, type ElongatedCostEstimate } from "./elongatedFormat";
import { emptySteps } from "./projectStore";
import { hasSubscribeOutro } from "./outro";
import type { ElongatedTrack, FactCard, Project, Scene, StepKind, StepState } from "./types";

export interface ElongatedPreset {
  name: string;
  targetSec: number;
}
export interface BlockTypeDef {
  id: string;
  desc: string;
}

interface RawConfig {
  presets: { name: string; target_sec: number }[];
  custom_min_sec: number;
  custom_max_sec: number;
  min_views: number;
  min_completion: number;
  chapter_target_sec: number;
  chapter_min_count: number;
  max_recommended_multiplier: number;
  search_max_uses_per_block: number;
  search_max_uses_cap: number;
  fact_model: "haiku" | "sonnet" | "opus";
  fact_extract_model: "haiku" | "sonnet" | "opus";
  chapter_length_tolerance: number;
  target_length_tolerance: number;
  block_types: { id: string; desc: string }[];
  required_block: string;
  grades: string[];
}
const cfg = raw as unknown as RawConfig;

export const PRESETS: ElongatedPreset[] = cfg.presets.map((p) => ({
  name: p.name,
  targetSec: p.target_sec,
}));
export const CUSTOM_MIN_SEC = cfg.custom_min_sec;
export const CUSTOM_MAX_SEC = cfg.custom_max_sec;
export const BLOCK_TYPES: BlockTypeDef[] = cfg.block_types;
export const BLOCK_TYPE_IDS: string[] = cfg.block_types.map((b) => b.id);
export const REQUIRED_BLOCK: string = cfg.required_block;
export const GRADES: string[] = cfg.grades;
export const CHAPTER_TOLERANCE = cfg.chapter_length_tolerance;
// 이 배수를 넘으면 원본 비중이 너무 작아진다 — 차단은 안 하고 화면에서 경고만 한다.
export const MAX_RECOMMENDED_MULTIPLIER = cfg.max_recommended_multiplier;
/** 챕터 하나의 검색 예산 — 대목 수에 비례하되 상한을 둔다(너무 조이면 카드가 0건이 된다). */
export function searchBudget(blockCount: number): number {
  return Math.max(1, Math.min(cfg.search_max_uses_cap, blockCount * cfg.search_max_uses_per_block));
}
// ★ 웹 검색을 도는 모델은 haiku 가 될 수 없다 — web_search 도구를 지원하지 않아 400 이 난다.
export const FACT_MODEL: "haiku" | "sonnet" | "opus" = cfg.fact_model ?? "sonnet";
// 검색 결과를 JSON 으로 옮겨 적기만 하는 2차 호출 — 도구가 없어 haiku 로 충분하다.
export const FACT_EXTRACT_MODEL: "haiku" | "sonnet" | "opus" = cfg.fact_extract_model ?? "haiku";
export const TARGET_TOLERANCE = cfg.target_length_tolerance;

// ── 길이 계산 ────────────────────────────────────────────────────────────────

/**
 * 확장판이 읽을 원본 씬들 — 건너뛴 씬과 구독 마무리 씬을 뺀다.
 * 구독 마무리는 롱폼 끝에 따로 붙는 것이라 챕터로 만들면 안 된다(컴필레이션의 buildSegment 와
 * 같은 규칙). 실제로 이걸 안 뺐더니 32자짜리 "마무리" 챕터가 생겨 챕터 균등 검수에 걸렸다.
 */
export function elongatedSourceScenes(scenes: Scene[]): Scene[] {
  const live = (scenes ?? []).filter((s) => !s.skipped);
  return hasSubscribeOutro(live) ? live.slice(0, -1) : live;
}

/** 원본 쇼츠의 낭독 길이(초) — 씬 나레이션 글자 수 기준(건너뛴 씬·구독 마무리 제외). */
export function sourceSeconds(scenes: Scene[]): number {
  return speakSeconds(...elongatedSourceScenes(scenes).map((s) => s.narration ?? ""));
}

// 배수·초 표기·비용 계산은 클라이언트도 쓰므로 순수 모듈에 두고 여기서 다시 내보낸다.
export { formatSeconds, multiplier, estimateCost } from "./elongatedFormat";
export type { CostRates, ElongatedCostEstimate } from "./elongatedFormat";

/**
 * 챕터 몇 개로 묶을 것인가 — 목표 길이 ÷ 챕터당 목표 길이.
 * 원본 씬을 묶어 만드는 것이므로 원본 씬 수를 넘을 수 없고, 최소 개수는 설정값을 따른다.
 */
export function chapterCount(targetSec: number, sourceSceneCount: number): number {
  const byLength = Math.max(cfg.chapter_min_count, Math.round(targetSec / cfg.chapter_target_sec));
  return Math.max(1, Math.min(byLength, Math.max(1, sourceSceneCount)));
}

/** 목표 길이(초) → 전체 본문 글자 예산. */
export function totalCharBudget(targetSec: number): number {
  return Math.round(targetSec * CHARS_PER_SEC);
}

/** 챕터 하나의 글자 예산 — 챕터는 대체로 균등해야 한다(chapter_length_tolerance). */
export function chapterCharBudget(targetSec: number, chapterCount: number): number {
  if (chapterCount <= 0) return 0;
  return Math.round(totalCharBudget(targetSec) / chapterCount);
}

/** 챕터 글자 수가 예산의 허용 범위 안인가 — 화면의 빨간 표시 판정. */
export function chapterOverBudget(chars: number, budget: number): boolean {
  return budget > 0 && chars > Math.round(budget * (1 + CHAPTER_TOLERANCE));
}

/** 목표 길이 ±20% 안인가(채점표 7번). */
export function withinTargetLength(totalChars: number, targetSec: number): boolean {
  const budget = totalCharBudget(targetSec);
  if (!budget) return false;
  return Math.abs(totalChars - budget) <= budget * TARGET_TOLERANCE;
}

/** 글자 수 → 초(화면 표시용). */
export function charsToSeconds(chars: number): number {
  return Math.round((chars / CHARS_PER_SEC) * 10) / 10;
}

// ── 예상 제작비 ──────────────────────────────────────────────────────────────
// 목표 길이를 정하는 순간 편당 비용이 정해진다(8분이면 씬 70개 = 영상비가 전체의 90%).
// 고르기 전에 화면에서 보이게 하려고 여기서 계산한다. 단가의 원천은 lib/cost.ts 하나다.

// 대본 단계 실측(Redis cost:entries, 2026-07-26):
//   설계 ₩678 · 사실 찾기 대목당 ₩551(Sonnet·대목 단위) · 본문 챕터당 ₩60 안팎.
// 여기서 두 번 줄였다: 사실 찾기를 챕터 단위로 묶고(호출 15→4), 모델을 haiku 로 내렸다(단가 1/3).
// 8분 기준 예상 = 설계 ₩678 + 사실 4챕터 ₩740 + 본문 ₩240 + 채점 ₩50 ≈ ₩1,700.
// 처음엔 ₩1,680으로 잡았다가 실측이 5배로 나왔다 — 다시 밑돌지 않게 넉넉히 잡는다.
// ※ web_search 서버 도구 사용료는 anthropicCostUsd 가 아직 세지 않는다(토큰만 계산).
const SCRIPT_STAGE_USD = 1.8;

/** 화면(서버·클라 공용)이 쓰는 단가 묶음. 단가의 원천은 lib/cost.ts 하나다. */
export function costRates(videoUsdPerScene: number = FAL_VIDEO_DEFAULT_USD): CostRates {
  return {
    videoUsdPerScene,
    imageUsd: OPENAI_IMAGE_PRICING["gpt-image-2"]?.medium ?? 0.04,
    voiceUsdPerChar: ELEVENLABS_USD_PER_CHAR,
    scriptUsd: SCRIPT_STAGE_USD,
    krwPerUsd: KRW_PER_USD,
    durationMin: DURATION_MIN,
    durationMax: DURATION_MAX,
    charsPerSec: CHARS_PER_SEC,
  };
}

export function estimateElongatedCost(
  targetSec: number,
  videoUsdPerScene: number = FAL_VIDEO_DEFAULT_USD
): ElongatedCostEstimate {
  return estimateCost(targetSec, costRates(videoUsdPerScene));
}

// ── 사실 카드 ────────────────────────────────────────────────────────────────

/** 다음 카드 id — 기존 카드의 최대 번호 + 1. */
export function nextCardId(cards: FactCard[]): string {
  const max = (cards ?? []).reduce((a, c) => {
    const m = /^F-(\d+)$/.exec(c.id ?? "");
    return m ? Math.max(a, parseInt(m[1], 10)) : a;
  }, 0);
  return `F-${String(max + 1).padStart(3, "0")}`;
}

/** 게시 전 재확인이 필요한 카드(가격·시세류). */
export function expiringCards(cards: FactCard[]): FactCard[] {
  return (cards ?? []).filter((c) => c.expires);
}

// ── 확장판 프로젝트 만들기 ───────────────────────────────────────────────────

function stepAt(kind: StepKind, status: StepState["status"], now: number): StepState {
  return { kind, status, params: {}, chat: [], updatedAt: now };
}

/** 확장판인가 — 스튜디오·목록 분기의 단일 판정. */
export function isElongated(p: Pick<Project, "elongated">): boolean {
  return !!p.elongated?.sourceProjectId;
}

/**
 * 지금 어디까지 왔는가 — 목록 배지와 스튜디오가 같은 판정을 쓰도록 한 곳에 둔다.
 * 화면 순서(설계 → 승인 → 본문 → 검수 → 렌더)를 그대로 따른다.
 */
export function elongatedStage(p: Pick<Project, "elongated" | "finalVideoUrl" | "scenes">): {
  key: "plan" | "approve" | "body" | "review" | "render" | "done";
  label: string;
} {
  const t = p.elongated;
  if (p.finalVideoUrl) return { key: "done", label: "완성" };
  if (!t?.plan) return { key: "plan", label: "설계 전" };
  if (!t.plan.approvedAt) return { key: "approve", label: "설계 승인 대기" };
  const bodies = t.plan.chapters.filter((c) => (c.body ?? "").trim()).length;
  if (bodies === 0) return { key: "body", label: "본문 대기" };
  if (bodies < t.plan.chapters.length)
    return { key: "body", label: `본문 ${bodies}/${t.plan.chapters.length}` };
  if ((p.scenes ?? []).length > 0) return { key: "render", label: "렌더 대기" };
  return { key: "review", label: "검수·렌더 대기" };
}

/**
 * 원본 쇼츠 한 편 + 목표 길이 → 확장판 프로젝트.
 * 원본은 읽기만 한다(스타일·목소리·모델 설정만 물려받는다). 씬은 아직 없다 —
 * 설계·본문을 거친 뒤 "렌더로 보내기"에서 챕터 본문을 씬으로 펼친다.
 */
export function buildElongated(args: {
  source: Project;
  targetSec: number;
  presetName?: string;
  ownerEmail?: string;
}): Project {
  const { source, targetSec, presetName, ownerEmail } = args;
  const now = Date.now();

  const track: ElongatedTrack = {
    sourceProjectId: source.id,
    sourceTitle: source.title,
    sourceSeconds: sourceSeconds(source.scenes ?? []),
    targetSec,
    ...(presetName ? { presetName } : {}),
    blockTypes: [...BLOCK_TYPE_IDS],
    facts: [],
    createdAt: now,
    updatedAt: now,
  };

  const steps = emptySteps();
  // 대본(=챕터 본문)이 나오기 전까지는 이미지·영상·음성 단계로 못 간다.
  steps.source = stepAt("source", "approved", now);
  for (const k of ["script", "keyframe", "images", "videos", "voiceover", "compose"] as StepKind[]) {
    steps[k] = stepAt(k, "pending", now);
  }

  return {
    id: randomUUID(),
    title: `${source.title} · 확장판`,
    ...(source.mode ? { mode: source.mode } : {}),
    format: "long",
    elongated: track,
    styleProfileId: source.styleProfileId,
    styleBible: source.styleBible,
    // 원본 키프레임을 16:9 재생성 레퍼런스로(같은 인물·화풍 유지).
    keyframeReferenceUrl: source.keyframeUrl,
    scenes: [],
    steps,
    ttsEnabled: source.ttsEnabled,
    ttsProvider: source.ttsProvider,
    voiceId: source.voiceId,
    voiceSpeed: source.voiceSpeed,
    videoModelId: source.videoModelId,
    videoCommonPrompt: source.videoCommonPrompt,
    subtitle: source.subtitle,
    watermark: source.watermark,
    credit: source.credit,
    userPrompt: source.userPrompt,
    ownerEmail: ownerEmail ?? source.ownerEmail,
    createdAt: now,
    updatedAt: now,
  };
}

/** 목표 길이 입력 검증 — 프리셋이든 직접 입력이든 여기를 통과해야 한다. */
export function validateTargetSec(sec: unknown): number {
  const n = typeof sec === "number" ? sec : Number(sec);
  if (!Number.isFinite(n)) throw new Error("목표 길이를 확인해주세요");
  const v = Math.round(n);
  if (v < CUSTOM_MIN_SEC || v > CUSTOM_MAX_SEC) {
    throw new Error(
      `목표 길이는 ${Math.round(CUSTOM_MIN_SEC / 60)}~${Math.round(CUSTOM_MAX_SEC / 60)}분 사이로 정해주세요`
    );
  }
  return v;
}
