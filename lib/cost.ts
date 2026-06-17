// ============================================================================
// 비용 추적 — cardnews cost.ts 이식 + 확장 (+fal +elevenlabs)
// ----------------------------------------------------------------------------
// 각 단계 API 호출 후 recordCost() 로 적재. CostFooter 가 합계를 보여준다.
// 단가는 vendor 별로 여기 한 곳에서 관리.
// ============================================================================

import { getRedis } from "./redis";
import type { CostEntry } from "./types";

export const KRW_PER_USD = 1400;

export function usdToKrw(usd: number): number {
  return Math.round(usd * KRW_PER_USD);
}

export function formatKrw(usd: number): string {
  return `₩${usdToKrw(usd).toLocaleString("ko-KR")}`;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

export interface AnthropicUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  model: string;
}

interface AnthropicPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

// USD per 1M tokens.
export const ANTHROPIC_PRICING: Record<string, AnthropicPricing> = {
  "claude-haiku-4-5-20251001": { input: 1.0, output: 5.0, cacheRead: 0.1, cacheWrite: 1.25 },
  "claude-sonnet-4-6": { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-8": { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
};

// USD per image (gpt-image-2). low 기본.
export const OPENAI_IMAGE_PRICING: Record<string, Record<string, number>> = {
  "gpt-image-2": { low: 0.011, medium: 0.04, high: 0.167 },
};

export function anthropicCostUsd(usage: AnthropicUsage): number {
  const p = ANTHROPIC_PRICING[usage.model];
  if (!p) return 0;
  const M = 1_000_000;
  return (
    (usage.inputTokens * p.input) / M +
    (usage.outputTokens * p.output) / M +
    ((usage.cacheReadTokens ?? 0) * (p.cacheRead ?? 0)) / M +
    ((usage.cacheWriteTokens ?? 0) * (p.cacheWrite ?? 0)) / M
  );
}

export function openaiImageCostUsd(
  model: string,
  quality: "low" | "medium" | "high" = "low",
  count = 1
): number {
  const tier = OPENAI_IMAGE_PRICING[model];
  if (!tier) return 0;
  return (tier[quality] ?? tier.low ?? 0) * count;
}

// USD per video (fal image-to-video). endpoint(모델 경로) 기준 대략값.
export const FAL_VIDEO_PRICING: Record<string, number> = {
  "fal-ai/minimax-video/image-to-video": 0.5,
  "fal-ai/kling-video/v1/standard/image-to-video": 0.25,
  "fal-ai/bytedance/seedance/v1/pro/image-to-video": 0.62,
};
export const FAL_VIDEO_DEFAULT_USD = 0.5;

export function falVideoCostUsd(endpoint: string): number {
  return FAL_VIDEO_PRICING[endpoint] ?? FAL_VIDEO_DEFAULT_USD;
}

// ElevenLabs TTS — 문자당 USD (eleven_multilingual_v2 기준 ~$0.30/1000자).
export const ELEVENLABS_USD_PER_CHAR = 0.0003;

export function elevenLabsCostUsd(chars: number): number {
  return Math.max(0, chars) * ELEVENLABS_USD_PER_CHAR;
}

const KEY = "cost:entries"; // list (best-effort 기록)

export async function recordCost(
  input: Omit<CostEntry, "id" | "createdAt">
): Promise<void> {
  const entry: CostEntry = {
    ...input,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  try {
    await getRedis().lpush(KEY, entry);
  } catch {
    /* best-effort — 비용 기록 실패가 사용자 흐름을 끊지 않게 */
  }
}

// projectId 주면 그 프로젝트 누적만, 없으면 전체 누적. (리롤 포함 모든 생성 합산)
export async function totalCostUsd(projectId?: string): Promise<number> {
  const entries = (await getRedis().lrange<CostEntry>(KEY, 0, -1)) ?? [];
  const filtered = projectId
    ? entries.filter((e) => e.projectId === projectId)
    : entries;
  return filtered.reduce((sum, e) => sum + (e.costUsd ?? 0), 0);
}
