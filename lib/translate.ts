// ============================================================================
// 다국어 번역 (다국어판) — 한국어 나레이션 → 목표 언어
// ----------------------------------------------------------------------------
// 씬 나레이션들을 한 번의 Claude 호출로 일괄 번역(비용 절약). 더빙/자막용이라
// 짧고 자연스럽게. 목표 언어는 lib/languages.ts 의 english 이름으로 지정.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";

function parseLines(raw: string): string[] | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { lines?: unknown };
    if (!Array.isArray(j.lines)) return null;
    return j.lines.map((x) => (typeof x === "string" ? x : ""));
  } catch {
    return null;
  }
}

export async function translateNarrations(
  projectId: string,
  narrations: string[],
  targetLanguage = "English",
  sourceLanguage = "Korean"
): Promise<{ translations: string[]; costUsd: number }> {
  const client = getAnthropic();
  const system =
    `Translate each ${sourceLanguage} subtitle line into natural, concise ${targetLanguage} suitable for ` +
    "on-screen video captions and voiceover (short, punchy). Keep the same order and the same " +
    'number of lines. Return ONLY JSON: {"lines":["...", "..."]}';
  const userMsg = JSON.stringify({ lines: narrations });

  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const text = r.content
    .filter((b: { type: string }) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("")
    .trim();

  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.haiku,
  });
  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.haiku,
    costUsd,
    meta: { kind: "subtitle-translate" },
  });

  const parsed = parseLines(text);
  // 개수 안 맞으면 길이에 맞춰 보정(빈 칸은 원문 유지 안 하고 빈 문자열).
  const translations = narrations.map((_, i) => parsed?.[i] ?? "");
  return { translations, costUsd };
}
