// ============================================================================
// 여러 소스 → 1개 영상 주제로 종합 (cardnews 의 "분할"을 aninews 용 "종합"으로 변형)
// ----------------------------------------------------------------------------
// 여러 기사/URL/텍스트/파일에서 뽑은 SourceMaterial[] 를 받아, Claude 가 하나의
// 일관된 한국어 본문으로 합친다. 1개면 그대로 반환(호출 비용 없음).
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import type { SourceMaterial } from "./source";

const MAX_MERGE_INPUT = 50_000;

export async function mergeSources(args: {
  materials: SourceMaterial[];
  userPrompt?: string;
  projectId?: string;
}): Promise<SourceMaterial> {
  const valid = (args.materials ?? []).filter((m) => m?.body?.trim());
  if (valid.length === 0) throw new Error("병합할 소스 본문이 없어요");
  if (valid.length === 1) return valid[0];

  const client = getAnthropic();
  const system =
    "You synthesize multiple Korean/English news articles or notes into ONE coherent Korean short-form video topic. " +
    'Output ONLY JSON: {"title":"...","body":"..."}. ' +
    "title: a concise Korean headline. " +
    "body: one coherent Korean narrative that integrates the key facts across ALL sources — no bullet lists, no '소스1/소스2' labels, no markdown. " +
    "Keep important facts and numbers, drop redundancy. If sources conflict, follow the main thread. Reflect the user's intent if given.";

  const joined = valid
    .map(
      (m, i) =>
        `--- 소스 ${i + 1}${m.sourceName ? ` (${m.sourceName})` : ""} ---\n제목: ${m.title}\n${m.body}`
    )
    .join("\n\n")
    .slice(0, MAX_MERGE_INPUT);

  const userMsg = [
    args.userPrompt ? `사용자 의도: ${args.userPrompt}\n` : "",
    "다음 여러 자료를 하나의 영상 주제로 종합해줘:",
    "",
    joined,
    "",
    'JSON 만 출력: {"title":"...","body":"..."}',
  ]
    .filter(Boolean)
    .join("\n");

  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 4000,
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
    model: MODELS.haiku,
  });
  try {
    await recordCost({
      projectId: args.projectId,
      vendor: "anthropic",
      model: MODELS.haiku,
      costUsd,
      meta: { kind: "merge", sources: valid.length },
    });
  } catch {
    /* 비용 기록 실패는 무시 */
  }

  let parsed: { title?: string; body?: string } = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    /* 파싱 실패 시 폴백 */
  }
  const title = (parsed.title || valid[0].title || "종합 뉴스").trim();
  const body = (parsed.body || valid.map((v) => v.body).join("\n\n")).trim();

  return {
    title,
    body,
    sourceName:
      valid.map((v) => v.sourceName).filter(Boolean).slice(0, 3).join(", ") || "종합",
    sourceUrl: valid[0].sourceUrl || "",
    publishedAt: valid[0].publishedAt ?? null,
  };
}
