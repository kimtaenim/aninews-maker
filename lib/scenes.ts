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

// 2단계는 나레이션만 생성한다 — image_prompt·motion 은 3·4·5단계에서 만든다(옵션).
const RawScene = z.object({
  narration: z.string().min(1),
  speaker: z.string().optional(), // [cliche] 대사 화자 A/B
  image_prompt: z.string().optional(),
  motion: z.string().optional(),
  duration_sec: z.number().optional(),
});

const RawScript = z.object({
  scenes: z.array(RawScene).min(1),
});

function clampDuration(d: number | undefined): number {
  if (typeof d !== "number" || !Number.isFinite(d)) return 5;
  return Math.max(DURATION_MIN, Math.min(DURATION_MAX, d));
}

// 한국어 TTS ≈ 4.5자/초. 나레이션 글자수로 길이(초) 추정 → 4~7 로 clamp.
const CHARS_PER_SEC = 4.5;
export function estimateDuration(text: string): number {
  const len = (text ?? "").trim().length;
  if (!len) return DURATION_MIN;
  return clampDuration(Math.ceil(len / CHARS_PER_SEC));
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

  return parsed.data.scenes.map((s, index) => {
    const narration = s.narration.trim();
    const speaker = (s.speaker ?? "").trim();
    return {
      index,
      narration,
      ...(speaker ? { speaker } : {}), // [cliche] 대사 화자
      // 2단계는 나레이션만 — 프롬프트·모션은 비워두고 3·4·5단계에서 생성.
      imagePrompt: (s.image_prompt ?? "").trim(),
      motion: (s.motion ?? "").trim(),
      // duration_sec 가 와도 무시하고 나레이션 길이로 자동 계산(승인 단계에서 보정).
      durationSec: estimateDuration(narration),
      status: "generated" as const,
    };
  });
}
