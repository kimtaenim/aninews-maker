// ============================================================================
// 쇼츠 제목 검수 — 닫힌 채점표로 원칙 항목별 통과/탈락만 판정한다.
// ----------------------------------------------------------------------------
// 생성기(titleGen)와 "같은" 원칙 파일(config/title-principles.json)을 읽는다.
// 자기일관성 테스트(scripts/test-title-consistency.ts)가 생성기 출력을 이 검수기에
// 통과시켜, 두 도구의 해석이 갈리는지(= 생성기-검수기 불일치 버그) 확인한다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { TITLE_REVIEW_SYSTEM_PROMPT } from "./titleReviewPrompt";
import { violatesBanned } from "./titleBanned";
import principles from "../config/title-principles.json";

export interface TitleReviewItem {
  id: number;
  name: string;
  verdict: "통과" | "탈락";
  quote: string;
  why: string;
  fix?: string;
}

export interface TitleReviewResult {
  title: string;
  items: TitleReviewItem[];
  bannedHits: string[]; // 모델 판정
  codeBanned: string[]; // 코드 검사(titleBanned) — 기계적으로 잡히는 것
  verdict: "통과" | "탈락";
  summary: string;
  costUsd: number;
}

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function buildReviewSystem(): string {
  return TITLE_REVIEW_SYSTEM_PROMPT.replace("{{PRINCIPLES}}", JSON.stringify(principles, null, 2));
}

export async function reviewTitle(args: {
  projectId: string;
  title: string;
  scriptText?: string; // 있으면 "제목의 약속을 대본이 주는가"(원칙 4) 판정에 쓴다
}): Promise<TitleReviewResult> {
  const { projectId, scriptText } = args;
  const title = (args.title ?? "").trim();
  if (!title) throw new Error("검수할 제목이 필요해요");

  const client = getAnthropic();
  const user = [`[검수할 제목]\n${title}`, scriptText ? `\n[대본]\n${scriptText}` : ""]
    .filter(Boolean)
    .join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 2000,
    system: buildReviewSystem(),
    messages: [{ role: "user", content: user }],
  });
  const blocks = r.content.filter((b: { type: string }) => b.type === "text") as Array<{
    type: "text";
    text: string;
  }>;
  const raw = blocks.map((b) => b.text).join("").trim();
  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.sonnet,
  });
  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd,
    meta: { kind: "title-review" },
  }).catch(() => {});

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("제목 검수 실패 — 응답에서 JSON 을 못 찾았어요");
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(m[0]) as Record<string, unknown>;
  } catch {
    throw new Error("제목 검수 JSON 파싱 실패");
  }

  const items: TitleReviewItem[] = (Array.isArray(j.items) ? j.items : []).map((it) => {
    const o = (it ?? {}) as Record<string, unknown>;
    const v = str(o.verdict);
    return {
      id: Number(o.id) || 0,
      name: str(o.name),
      verdict: v === "탈락" ? "탈락" : "통과",
      quote: str(o.quote),
      why: str(o.why),
      fix: str(o.fix) || undefined,
    };
  });

  const bannedHits = (Array.isArray(j.banned_hits) ? j.banned_hits : [])
    .map((x) => str(x))
    .filter(Boolean);
  const codeBanned = violatesBanned(title);
  // 코드 검사에 걸린 게 있으면 모델이 통과라 해도 탈락(기계 판정 우선).
  const failed = items.some((i) => i.verdict === "탈락") || bannedHits.length > 0 || codeBanned.length > 0;

  return {
    title,
    items,
    bannedHits,
    codeBanned,
    verdict: failed ? "탈락" : "통과",
    summary: str(j.summary) || (failed ? "탈락 항목 있음" : "통과"),
    costUsd,
  };
}
