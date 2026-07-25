// ============================================================================
// 제목 자동 생성 — 확정 대본으로 제목 후보 3개 + 추천 + SEO 키워드를 만든다.
// ----------------------------------------------------------------------------
// 스크립트 확정(step approve script) 직후 호출. 파이프라인 공용 Anthropic 클라이언트 재사용.
// banned 위반이 있거나 JSON 파싱 실패면 1회 자동 재시도(위반 지적 문구 덧붙임).
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { TITLE_SYSTEM_PROMPT } from "./titlePrompt";
import { violatesBanned } from "./titleBanned";
import principles from "../config/title-principles.json";

// 원칙은 config/title-principles.json 단일 원천 — 검수기(titleReview)도 같은 파일을 읽는다.
// 프롬프트에 원칙을 하드코딩하면 사본이 갈라져 생성기 결과를 검수기가 탈락시킨다.
export function buildTitleSystem(): string {
  return TITLE_SYSTEM_PROMPT.replace("{{PRINCIPLES}}", JSON.stringify(principles, null, 2));
}

export interface TitleCandidate {
  title: string;
  structure?: string;
  first_word_drawer?: string;
  principle_check?: Record<string, boolean>;
  rationale?: string;
  banned?: string[]; // 검사에서 걸린 위반(있으면) — UI 경고·로그용
}

export interface TitleResult {
  candidates: TitleCandidate[];
  recommended_index: number;
  recommend_reason: string;
  seo_keywords: string[];
  costUsd: number;
}

// 확정 대본을 ①-⑧ 씬 텍스트로 직렬화.
export function scriptToText(narrations: string[]): string {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  return narrations
    .map((n, i) => `${circled[i] ?? `${i + 1}.`} ${(n ?? "").trim()}`)
    .filter((l) => l.trim().length > 2)
    .join("\n");
}

interface ParsedTitle {
  candidates?: unknown;
  recommended_index?: unknown;
  recommend_reason?: unknown;
  seo_keywords?: unknown;
}

function parse(raw: string): TitleResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: ParsedTitle;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const cands = Array.isArray(j.candidates) ? j.candidates : [];
  const candidates: TitleCandidate[] = cands
    .map((c) => {
      const o = (c ?? {}) as Record<string, unknown>;
      const title = typeof o.title === "string" ? o.title.trim() : "";
      return {
        title,
        structure: typeof o.structure === "string" ? o.structure : undefined,
        first_word_drawer: typeof o.first_word_drawer === "string" ? o.first_word_drawer : undefined,
        principle_check:
          o.principle_check && typeof o.principle_check === "object"
            ? (o.principle_check as Record<string, boolean>)
            : undefined,
        rationale: typeof o.rationale === "string" ? o.rationale : undefined,
        banned: violatesBanned(title),
      };
    })
    .filter((c) => c.title.length > 0);
  if (candidates.length === 0) return null;
  const ri = typeof j.recommended_index === "number" ? j.recommended_index : 0;
  return {
    candidates,
    recommended_index: ri >= 0 && ri < candidates.length ? ri : 0,
    recommend_reason: typeof j.recommend_reason === "string" ? j.recommend_reason : "",
    seo_keywords: Array.isArray(j.seo_keywords)
      ? j.seo_keywords.filter((k): k is string => typeof k === "string").slice(0, 5)
      : [],
    costUsd: 0,
  };
}

export async function generateTitles(args: {
  projectId: string;
  scriptText: string;
}): Promise<TitleResult> {
  const { projectId, scriptText } = args;
  const client = getAnthropic();
  let totalCost = 0;

  const call = async (extra?: string): Promise<TitleResult | null> => {
    const user = extra ? `${scriptText}\n\n${extra}` : scriptText;
    const r = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 1500,
      system: buildTitleSystem(),
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
  // 파싱 실패 또는 banned 위반 후보가 있으면 1회 재시도(위반 지적).
  const hasBanned = (res: TitleResult | null) =>
    !!res && res.candidates.some((c) => (c.banned?.length ?? 0) > 0);
  if (!result || hasBanned(result)) {
    const bad = result
      ? result.candidates
          .filter((c) => (c.banned?.length ?? 0) > 0)
          .map((c) => `"${c.title}" (위반: ${c.banned!.join(", ")})`)
          .join("; ")
      : "";
    const note = result
      ? `앞선 후보 중 banned 규칙 위반이 있었다: ${bad}. banned 를 모두 지켜 3개를 다시 써라.`
      : "JSON 형식이 어긋났다. 지정된 JSON 만 정확히 다시 출력하라.";
    const retry = await call(note);
    // 재시도가 더 깨끗하면 채택, 아니면 원본 유지(둘 다 실패면 예외).
    if (retry && (!result || !hasBanned(retry))) result = retry;
  }

  if (!result) throw new Error("제목 생성 실패 — 응답에서 JSON 을 못 찾았어요");

  await recordCost({ projectId, vendor: "anthropic", model: MODELS.sonnet, costUsd: totalCost, meta: { kind: "title" } });
  result.costUsd = totalCost;
  return result;
}
