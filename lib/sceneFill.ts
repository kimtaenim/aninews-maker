// ============================================================================
// 새 씬 자동 채우기 (2단계 보강) — 나레이션 한 줄 → image_prompt · motion · 길이
// ----------------------------------------------------------------------------
// 사용자가 스크립트 단계에서 씬을 추가하고 나레이션만 입력하면, Claude 가 그 씬의
// 이미지 프롬프트와 모션을 styleBible 에 맞춰 생성하고, 길이는 텍스트 분량으로 추정.
// 검열 안전·차분/은유 규칙은 generateScript 와 동일하게 적용한다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { DURATION_MIN, DURATION_MAX } from "./scenes";

// 한국어 TTS 평균 ≈ 4.5자/초 (approve 라우트와 동일 기준).
const CHARS_PER_SEC = 4.5;

// 나레이션 분량으로 길이(초) 추정 — 4~7초 범위로 클램프(긴 텍스트는 승인 단계에서 보정).
export function estimateDuration(text: string): number {
  const len = (text ?? "").trim().length;
  if (!len) return DURATION_MIN;
  const d = Math.ceil(len / CHARS_PER_SEC);
  return Math.max(DURATION_MIN, Math.min(DURATION_MAX, d));
}

export async function fillSceneFromNarration(args: {
  projectId: string;
  narration: string;
  styleBible: string;
}): Promise<{ imagePrompt: string; motion: string; durationSec: number; costUsd: number }> {
  const narration = (args.narration ?? "").trim();
  if (!narration) throw new Error("나레이션을 입력해주세요");

  const client = getAnthropic();
  const system =
    "You generate ONE short-form video scene's visual direction from a single Korean narration line, " +
    "consistent with the given style bible. " +
    'Output ONLY JSON: {"image_prompt":"...","motion":"..."}. ' +
    "image_prompt: English. A calm, censorship-safe, metaphorical everyday visual that conveys the narration — " +
    "avoid protests, raised fists, marching crowds, violence, weapons, blood, political slogans/symbols, real public figures. " +
    "Keep on-image text minimal. " +
    "motion: English. Small and gentle only (slow camera, subtle movement). No big, fast, or violent action.";
  const userMsg = [
    `Style bible:\n${args.styleBible}`,
    "",
    `Narration (Korean): ${narration}`,
    "",
    'JSON only: {"image_prompt":"...","motion":"..."}',
  ].join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 700,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const raw = (
    r.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>
  )
    .map((b) => b.text)
    .join("")
    .trim();

  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.sonnet,
  });
  try {
    await recordCost({
      projectId: args.projectId,
      vendor: "anthropic",
      model: MODELS.sonnet,
      costUsd,
      meta: { kind: "scene-fill" },
    });
  } catch {
    /* 비용 기록 실패는 무시 */
  }

  let parsed: { image_prompt?: string; motion?: string } = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    /* 파싱 실패 시 빈 값 폴백 */
  }

  return {
    imagePrompt: (parsed.image_prompt || "").trim(),
    motion: (parsed.motion || "").trim(),
    durationSec: estimateDuration(narration),
    costUsd,
  };
}
