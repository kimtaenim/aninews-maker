// ============================================================================
// 롱폼 전체 구조 검수 — 오프닝+세그먼트순서+연결+마무리를 열린 고리 원칙으로 진단·수정안.
// ----------------------------------------------------------------------------
// 파이프라인 공용 Anthropic 클라이언트 재사용. JSON 파싱 실패면 1회 재시도.
// 위반이 있어도 pass=false 로 그대로 반환(원문 변경·동의 흐름은 UI/route).
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { LONGFORM_REVIEW_SYSTEM_PROMPT } from "./longformReviewPrompt";
import { SCENE_CHAR_MAX } from "./longformScript";
import allPrinciples from "../config/longform-principles.json";
// ★ 검수기도 생성기와 같은 원칙을 읽는다 — 이 채널의 대본 원칙은 쇼츠 파일 하나다.
// 예전엔 롱폼 원칙 파일의 opening/bridge/ending/style 을 주입했는데, 그건 2026-07-25에 폐기된
// 자작 원칙이라(자체 구독 문구·자체 길이 예산·예시 문장) 검수기가 생성기 결과를 탈락시켰다.
import shortsPrinciples from "../config/script-principles.json";

const principles = {
  대본원칙_쇼츠: shortsPrinciples,
  // 롱폼에만 있는 것 = 세그먼트 순서 설계뿐(lib/longformScript.ts 와 같은 주입).
  롱폼_세그먼트순서: allPrinciples.segment_order,
};

export interface LongformReviewInput {
  topic: string;
  openingLines: string[];
  segments: { title: string; summary: string }[];
  connectors: { after: number; text: string }[];
  closingLines: string[];
  // 오프닝 툴이 선언한 열린 고리 — 있으면 이 고리를 "기준"으로 검수(호응). 없으면 스크립트에서 추론.
  declaredLoop?: { question: string; closesAt: string; closingLineHint: string } | null;
  chapterBridges?: { chapter: number; role: string; bridgeHint: string }[];
}

export interface LongformReviewResult {
  pass: boolean;
  loopMap: { part: string; status: string; note: string }[];
  violations: string[];
  diagnosisSummary: string;
  consentQuestion: string;
  revisedOpening: string[] | null;
  revisedConnectors: { after: number; revised: string }[];
  revisedClosing: string[] | null;
  suggestedOrder: number[] | null;
  reason: string;
  costUsd: number;
}

export function assembleReviewText(d: LongformReviewInput): string {
  const lines: string[] = [];
  lines.push(`[주제] ${d.topic}`);
  if (d.declaredLoop && d.declaredLoop.question.trim()) {
    lines.push(
      `\n[오프닝이 선언한 열린 고리 — 이걸 기준 고리로 검수]\n  연 질문: ${d.declaredLoop.question}\n  닫는 위치: ${d.declaredLoop.closesAt}` +
        (d.declaredLoop.closingLineHint ? `\n  닫는 힌트: ${d.declaredLoop.closingLineHint}` : "")
    );
  }
  lines.push(`\n[오프닝]\n${d.openingLines.length ? d.openingLines.join(" ") : "(없음)"}`);
  lines.push("\n[세그먼트 순서]");
  d.segments.forEach((s, i) => {
    const bridge = d.chapterBridges?.find((b) => b.chapter === i + 1 || b.chapter === i);
    const roleHint = bridge ? ` (오프닝이 의도한 역할: ${bridge.role} — ${bridge.bridgeHint})` : "";
    lines.push(`  ${i}. [${s.title}] ${s.summary}${roleHint}`);
  });
  lines.push("\n[진행자 연결]");
  if (d.connectors.length) {
    d.connectors.forEach((c) => lines.push(`  세그 ${c.after}→${c.after + 1}: ${c.text || "(없음)"}`));
  } else {
    lines.push("  (없음)");
  }
  lines.push(`\n[마무리]\n${d.closingLines.length ? d.closingLines.join(" ") : "(없음)"}`);
  return lines.join("\n");
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function toLines(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const arr = v.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
  return arr.length ? arr : null;
}

export function parseLongformReview(raw: string): LongformReviewResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const loopMap = Array.isArray(j.loop_map)
    ? j.loop_map.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return { part: toStr(o.part), status: toStr(o.status), note: toStr(o.note) };
      })
    : [];
  const connectors = Array.isArray(j.revised_connectors)
    ? j.revised_connectors
        .map((e) => {
          const o = (e ?? {}) as Record<string, unknown>;
          return { after: typeof o.after === "number" ? o.after : Number(o.after) || 0, revised: toStr(o.revised) };
        })
        .filter((c) => c.revised.trim().length > 0)
    : [];
  const order = Array.isArray(j.suggested_order)
    ? j.suggested_order.map((n) => (typeof n === "number" ? n : Number(n))).filter((n) => Number.isInteger(n))
    : null;
  return {
    pass: j.pass === true,
    loopMap,
    violations: Array.isArray(j.violations) ? j.violations.filter((v): v is string => typeof v === "string") : [],
    diagnosisSummary: toStr(j.diagnosis_summary),
    consentQuestion: toStr(j.consent_question) || "구조를 열린 고리로 수정해볼까요?",
    revisedOpening: toLines(j.revised_opening),
    revisedConnectors: connectors,
    revisedClosing: toLines(j.revised_closing),
    suggestedOrder: order && order.length ? order : null,
    reason: toStr(j.reason),
    costUsd: 0,
  };
}

export async function reviewLongform(args: {
  projectId: string;
  input: LongformReviewInput;
}): Promise<LongformReviewResult> {
  const { projectId, input } = args;
  const client = getAnthropic();
  const system = LONGFORM_REVIEW_SYSTEM_PROMPT.replace(
    "{{PRINCIPLES}}",
    JSON.stringify(principles, null, 2)
    // 씬 글자 상한은 생성기와 같은 값을 쓴다 — 검수기에 숫자를 따로 적으면 사본이 갈라진다.
  ).replaceAll("{{SCENE_CHARS}}", String(SCENE_CHAR_MAX));
  const text = assembleReviewText(input);
  let totalCost = 0;

  const call = async (extra?: string): Promise<LongformReviewResult | null> => {
    const r = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: extra ? `${text}\n\n${extra}` : text }],
    });
    const textBlocks = r.content.filter(
      (b: { type: string }) => b.type === "text"
    ) as Array<{ type: "text"; text: string }>;
    const rawOut = textBlocks.map((b) => b.text).join("").trim();
    totalCost += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.sonnet,
    });
    return parseLongformReview(rawOut);
  };

  let result = await call();
  if (!result) result = await call("JSON 형식이 어긋났다. 지정된 JSON 만 정확히 다시 출력하라.");
  if (!result) throw new Error("롱폼 구조 검수 실패 — 응답에서 JSON 을 못 찾았어요");

  // suggested_order 검증 — 세그먼트 수와 같은 집합의 재배열이 아니면 무시.
  if (result.suggestedOrder) {
    const n = input.segments.length;
    const ok =
      result.suggestedOrder.length === n &&
      [...result.suggestedOrder].sort((a, b) => a - b).join(",") === Array.from({ length: n }, (_, i) => i).join(",");
    if (!ok) result.suggestedOrder = null;
  }

  await recordCost({ projectId, vendor: "anthropic", model: MODELS.sonnet, costUsd: totalCost, meta: { kind: "longform-review" } });
  result.costUsd = totalCost;
  return result;
}
