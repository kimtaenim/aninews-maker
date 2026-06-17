// ============================================================================
// 씬 배열 파싱·검증 (2단계 산출물) — zod
// ----------------------------------------------------------------------------
// Claude 가 낸 JSON 을 안전하게 Scene[] 로 변환. duration 은 4~7 로 clamp(하드락
// 아니라 리듬 가드). 코드블록/prose 섞여 와도 {"scenes":[...]} 추출.
// ============================================================================

import { z } from "zod";
import type { Scene } from "./types";

export const DURATION_MIN = 4;
export const DURATION_MAX = 7;

const RawScene = z.object({
  narration: z.string().min(1),
  image_prompt: z.string().min(1),
  motion: z.string().min(1),
  duration_sec: z.number().optional(),
});

const RawScript = z.object({
  scenes: z.array(RawScene).min(1),
});

function clampDuration(d: number | undefined): number {
  if (typeof d !== "number" || !Number.isFinite(d)) return 5;
  return Math.max(DURATION_MIN, Math.min(DURATION_MAX, d));
}

/** Claude 텍스트 응답 → Scene[]. 실패 시 null. */
export function parseScenes(raw: string): Scene[] | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let json: unknown;
  try {
    json = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const parsed = RawScript.safeParse(json);
  if (!parsed.success) return null;

  return parsed.data.scenes.map((s, index) => ({
    index,
    narration: s.narration.trim(),
    imagePrompt: s.image_prompt.trim(),
    motion: s.motion.trim(),
    durationSec: clampDuration(s.duration_sec),
    status: "generated" as const,
  }));
}
