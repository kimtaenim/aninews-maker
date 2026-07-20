// ============================================================================
// 롱폼 오프닝 자동 생성 — 주제+챕터로 열린 고리 오프닝 스크립트를 만든다.
// ----------------------------------------------------------------------------
// 롱폼 구성(세그먼트=챕터) 확정 후 호출. 파이프라인 공용 Anthropic 클라이언트 재사용.
// roadmap_leak(목차 노출)이거나 JSON 파싱 실패면 1회 자동 재생성.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { OPENING_SYSTEM_PROMPT } from "./openingPrompt";
import { openingViolations } from "./openingCheck";

export interface OpeningGenResult {
  script: string[];
  openLoop: { question: string; closesAt: string; closingLineHint: string };
  chapterBridges: { chapter: number; role: string; bridgeHint: string }[];
  selfCheck: { firstWordDrawer?: string; roadmapLeak?: boolean; midpointExitCost?: string };
  violations: string[]; // 코드 검사(로드맵 누출·banned)로 잡힌 것 — UI 경고·로그용
  costUsd: number;
}

export function chaptersToText(chapters: { title: string; summary: string }[]): string {
  return chapters
    .map((c, i) => `${i + 1}. ${c.title.trim()} — ${(c.summary ?? "").trim()}`)
    .join("\n");
}

interface Parsed {
  opening_script?: unknown;
  open_loop?: { question?: unknown; closes_at?: unknown; closing_line_hint?: unknown };
  chapter_bridges?: unknown;
  self_check?: { first_word_drawer?: unknown; roadmap_leak?: unknown; midpoint_exit_cost?: unknown };
}

function parse(raw: string): OpeningGenResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Parsed;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const script = Array.isArray(j.opening_script)
    ? j.opening_script.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim())
    : [];
  if (script.length === 0) return null;

  const ol = j.open_loop ?? {};
  const bridges = Array.isArray(j.chapter_bridges)
    ? j.chapter_bridges.map((b) => {
        const o = (b ?? {}) as Record<string, unknown>;
        return {
          chapter: typeof o.chapter === "number" ? o.chapter : Number(o.chapter) || 0,
          role: typeof o.role === "string" ? o.role : "",
          bridgeHint: typeof o.bridge_hint === "string" ? o.bridge_hint : "",
        };
      })
    : [];
  const sc = j.self_check ?? {};
  return {
    script,
    openLoop: {
      question: typeof ol.question === "string" ? ol.question : "",
      closesAt: typeof ol.closes_at === "string" ? ol.closes_at : String(ol.closes_at ?? "마지막 챕터"),
      closingLineHint: typeof ol.closing_line_hint === "string" ? ol.closing_line_hint : "",
    },
    chapterBridges: bridges,
    selfCheck: {
      firstWordDrawer: typeof sc.first_word_drawer === "string" ? sc.first_word_drawer : undefined,
      roadmapLeak: sc.roadmap_leak === true,
      midpointExitCost: typeof sc.midpoint_exit_cost === "string" ? sc.midpoint_exit_cost : undefined,
    },
    violations: openingViolations(script),
    costUsd: 0,
  };
}

export async function generateOpening(args: {
  projectId: string;
  topic: string;
  chapters: { title: string; summary: string }[];
}): Promise<OpeningGenResult> {
  const { projectId, topic, chapters } = args;
  const client = getAnthropic();
  let totalCost = 0;

  const call = async (extra?: string): Promise<OpeningGenResult | null> => {
    const user = [`주제: ${topic}`, "", "챕터:", chaptersToText(chapters), extra ? `\n${extra}` : ""].join("\n");
    const r = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 2000,
      system: OPENING_SYSTEM_PROMPT,
      messages: [{ role: "user", content: user }],
    });
    const textBlocks = r.content.filter(
      (b: { type: string }) => b.type === "text"
    ) as Array<{ type: "text"; text: string }>;
    const raw = textBlocks.map((b) => b.text).join("").trim();
    totalCost += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.sonnet,
    });
    return parse(raw);
  };

  let result = await call();
  // 로드맵 누출(모델 self_check 또는 코드 검사) 또는 파싱 실패면 1회 재생성.
  const leaked = (res: OpeningGenResult | null) =>
    !!res && (res.selfCheck.roadmapLeak === true || res.violations.length > 0);
  if (!result || leaked(result)) {
    const note = result
      ? `앞선 오프닝이 목차/로드맵을 노출했거나 금지 표현을 썼다(${result.violations.join(", ") || "roadmap_leak"}). "첫 번째로/차례로/정리해드릴게요" 같은 목차 노출 없이, 답을 못 들으면 손해인 열린 고리 하나만 남기고 다시 써라.`
      : "JSON 형식이 어긋났다. 지정된 JSON 만 정확히 다시 출력하라.";
    const retry = await call(note);
    if (retry && (!result || !leaked(retry))) result = retry;
  }

  if (!result) throw new Error("오프닝 생성 실패 — 응답에서 JSON 을 못 찾았어요");
  await recordCost({ projectId, vendor: "anthropic", model: MODELS.sonnet, costUsd: totalCost, meta: { kind: "longform-opening" } });
  result.costUsd = totalCost;
  return result;
}
