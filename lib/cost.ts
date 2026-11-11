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
  "claude-opus-4-8": { input: 5.0, output: 25.0, cacheRead: 0.5, cacheWrite: 6.25 },
};

// USD per image (gpt-image-2). low 기본.
// 장당 고정가 표 — 토큰 정보가 응답에 없을 때 쓰는 폴백이다.
// GPT-Image-2.6 은 장당 고정가가 없고 토큰으로 매긴다(아래 OPENAI_IMAGE_TOKEN_PRICING).
// 2.6 의 low/medium 은 추정치. high 는 공개된 추정치가 없어 medium 으로 떨어진다
// (낮게 잡아 0 에 가깝게 보이는 것보다 낫다).
export const OPENAI_IMAGE_PRICING: Record<string, Record<string, number>> = {
  "gpt-image-2": { low: 0.011, medium: 0.04, high: 0.167 },
  "gpt-image-2.6-sunburst": { low: 0.025, medium: 0.044 },
};

// GPT-Image-2.6 과금 — 100만 토큰당 USD. 응답의 usage 로 계산한다.
export const OPENAI_IMAGE_TOKEN_PRICING = {
  textInput: 5,
  imageInput: 8,
  imageOutput: 30,
} as const;

// OpenAI Images API 가 돌려주는 usage (SDK 버전에 따라 없을 수 있어 전부 옵셔널).
export interface OpenAIImageUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  input_tokens_details?: {
    text_tokens?: number | null;
    image_tokens?: number | null;
  } | null;
}

// usage 로 비용 계산. 토큰 정보가 없으면 null — 호출부가 장당 추정치로 넘어간다.
export function openaiImageUsageCostUsd(
  usage: OpenAIImageUsage | null | undefined
): number | null {
  if (!usage) return null;
  const out = Number(usage.output_tokens ?? 0);
  const inTotal = Number(usage.input_tokens ?? 0);
  if (!(out > 0) && !(inTotal > 0)) return null;

  const det = usage.input_tokens_details;
  const text = Number(det?.text_tokens ?? 0);
  const img = Number(det?.image_tokens ?? 0);
  // 입력 내역이 없거나 비어 있으면 전부 텍스트 입력으로 본다(이미지를 안 넣은 generate).
  const hasDetail = text > 0 || img > 0;
  const textTok = hasDetail ? text : inTotal;
  const imgTok = hasDetail ? img : 0;

  const M = 1_000_000;
  return (
    (textTok * OPENAI_IMAGE_TOKEN_PRICING.textInput) / M +
    (imgTok * OPENAI_IMAGE_TOKEN_PRICING.imageInput) / M +
    (out * OPENAI_IMAGE_TOKEN_PRICING.imageOutput) / M
  );
}

// 이미지 한 번 호출의 비용 — usage 가 오면 토큰으로, 없으면 장당 추정치로.
// usage 는 그 호출 전체(n장)를 덮으므로 count 는 폴백에서만 쓴다.
export function imageCallCostUsd(args: {
  usage?: OpenAIImageUsage | null;
  model: string;
  quality?: "low" | "medium" | "high";
  count?: number;
}): number {
  const fromUsage = openaiImageUsageCostUsd(args.usage);
  if (fromUsage !== null) return fromUsage;
  return openaiImageCostUsd(args.model, args.quality ?? "low", args.count ?? 1);
}

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
  // 해당 등급이 표에 없으면 medium → low 순으로 떨어진다. low 로 바로 떨어뜨리면
  // 비싼 등급이 싸게 잡혀 "비용이 거의 안 나온 것처럼" 보인다.
  return (tier[quality] ?? tier.medium ?? tier.low ?? 0) * count;
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

// Grok(xAI) image-to-video — 대략값(실측 후 조정). 720p 단편 기준.
export const GROK_VIDEO_USD = 0.5;
export function grokVideoCostUsd(): number {
  return GROK_VIDEO_USD;
}

// Kling(직접 API) image-to-video — 대략값(실측 후 조정). 5초 std 기준.
export const KLING_VIDEO_USD = 0.35;
export function klingVideoCostUsd(): number {
  return KLING_VIDEO_USD;
}

// MiniMax(직접 API) image-to-video — 초당 단가 × 기본 6초. env MINIMAX_VIDEO_COST 로 조정.
// re-animator 실측 기준 초당 $0.045.
export const MINIMAX_VIDEO_USD_PER_SEC = Number(process.env.MINIMAX_VIDEO_COST || 0.045);
export function minimaxVideoCostUsd(seconds = 6): number {
  return MINIMAX_VIDEO_USD_PER_SEC * Math.max(1, seconds);
}

// ElevenLabs TTS — 문자당 USD (eleven_multilingual_v2 기준 ~$0.30/1000자).
export const ELEVENLABS_USD_PER_CHAR = 0.0003;

export function elevenLabsCostUsd(chars: number): number {
  return Math.max(0, chars) * ELEVENLABS_USD_PER_CHAR;
}

// Typecast TTS — 크레딧 기반이라 정확 단가는 플랜마다 다름. 추정치로 적재하고
// 실제 청구와 맞춰 TYPECAST_USD_PER_CHAR 로 보정한다(미지정 시 ElevenLabs 수준).
export const TYPECAST_USD_PER_CHAR =
  Number(process.env.TYPECAST_USD_PER_CHAR) || 0.0003;

export function typecastCostUsd(chars: number): number {
  return Math.max(0, chars) * TYPECAST_USD_PER_CHAR;
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
