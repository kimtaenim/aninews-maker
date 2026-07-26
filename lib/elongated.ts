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
import { emptySteps } from "./projectStore";
import type { ElongatedTrack, FactCard, Project, StepKind, StepState } from "./types";

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
export const TARGET_TOLERANCE = cfg.target_length_tolerance;

// ── 길이 계산 ────────────────────────────────────────────────────────────────

/** 원본 쇼츠의 낭독 길이(초) — 씬 나레이션 글자 수 기준(건너뛴 씬 제외). */
export function sourceSeconds(scenes: { narration?: string; skipped?: boolean }[]): number {
  return speakSeconds(...(scenes ?? []).filter((s) => !s.skipped).map((s) => s.narration ?? ""));
}

/** 목표 ÷ 원본. 원본이 0이면 0. */
export function multiplier(sourceSec: number, targetSec: number): number {
  if (!sourceSec) return 0;
  return Math.round((targetSec / sourceSec) * 10) / 10;
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

/** 초 → "5분 12초" 표기. */
export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m ? `${m}분 ${r}초` : `${r}초`;
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
