// ============================================================================
// [롱폼 모듈 1] 제목 생성 — 구성(constituents)으로 검색어 → 제목 후보 5개 → 추천.
// ----------------------------------------------------------------------------
// 파이프라인의 첫 모듈. 출력의 title_promise 가 모듈 2~5 전부의 기준점이 되므로,
// 여기서 멈추고 사용자 확정을 받은 뒤에야 다음 모듈이 돈다(route/UI 가 담당).
// 코드 검사(시점 표현·묶음 가치·앞 30자)에 걸리면 1회 자동 재생성.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import {
  LONGFORM_TITLE_SYSTEM_PROMPT,
  LONGFORM_TITLE_REVIEW_SYSTEM_PROMPT,
} from "./longformTitlePrompt";
import { titleViolations, thumbnailTextViolations } from "./longformTitleCheck";
import principles from "../config/longform-principles.json";
import type { LongformTitleCandidate, LongformTitlePackage, LongformTitleReview } from "./types";

export interface LongformConstituent {
  title: string; // 쇼츠 원제목
  topic: string; // 핵심 소재
  performance?: string; // 실적(선택) — 순서 설계·엔드스크린 선정에 쓰인다
  segmentId?: string; // 앱 안에서 세그먼트 프로젝트 id (드라이런이면 없음)
}

export interface LongformTitleInput {
  type: "compilation" | "original";
  constituents: LongformConstituent[];
  coreTopic: string;
  viewerPayoff: string;
  targetKeywords?: string[];
}

export function titleInputToText(input: LongformTitleInput): string {
  const lines: string[] = [];
  lines.push(`[유형] ${input.type === "original" ? "오리지널" : "컴필레이션"}`);
  lines.push(`[핵심 주제] ${input.coreTopic}`);
  lines.push(`[끝까지 보면 얻는 것] ${input.viewerPayoff}`);
  if (input.targetKeywords?.length) lines.push(`[운영자 지정 검색어] ${input.targetKeywords.join(", ")}`);
  lines.push("[구성]");
  input.constituents.forEach((c, i) => {
    lines.push(`  ${i + 1}. ${c.title} — 소재: ${c.topic}${c.performance ? ` / 실적: ${c.performance}` : ""}`);
  });
  return lines.join("\n");
}

type Json = Record<string, unknown>;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function boolMap(v: unknown): Record<string, boolean> {
  if (!v || typeof v !== "object") return {};
  return Object.fromEntries(
    Object.entries(v as Json).map(([k, val]) => [k, val === true])
  );
}

function parse(raw: string): Omit<LongformTitlePackage, "generatedAt"> | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Json;
  try {
    j = JSON.parse(m[0]) as Json;
  } catch {
    return null;
  }
  const primaryKeyword = str(j.primary_keyword);
  const candidates: LongformTitleCandidate[] = (Array.isArray(j.candidates) ? j.candidates : [])
    .map((c) => {
      const o = (c ?? {}) as Json;
      const title = str(o.title);
      const thumbnailText = str(o.thumbnail_text);
      return {
        title,
        thumbnailText,
        principlesCheck: boolMap(o.principles_check),
        screening: boolMap(o.screening),
        violations: [
          ...titleViolations(title, primaryKeyword),
          ...thumbnailTextViolations(thumbnailText, title),
        ],
      };
    })
    .filter((c) => c.title.length > 0);
  if (candidates.length === 0) return null;

  const ri = typeof j.recommended_index === "number" ? j.recommended_index : 0;
  return {
    keywordCandidates: (Array.isArray(j.keyword_candidates) ? j.keyword_candidates : [])
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim())
      .filter(Boolean),
    primaryKeyword,
    secondaryKeyword: str(j.secondary_keyword),
    keywordRationale: str(j.keyword_rationale),
    candidates,
    rejected: (Array.isArray(j.rejected) ? j.rejected : [])
      .map((r) => {
        const o = (r ?? {}) as Json;
        return { title: str(o.title), reason: str(o.reason) };
      })
      .filter((r) => r.title.length > 0),
    recommendation: str(j.recommendation),
    recommendedIndex: ri >= 0 && ri < candidates.length ? ri : 0,
    titlePromise: str(j.title_promise),
  };
}

const dirtyCount = (p: { candidates: LongformTitleCandidate[] } | null) =>
  p ? p.candidates.filter((c) => (c.violations?.length ?? 0) > 0).length : Number.MAX_SAFE_INTEGER;

export async function generateLongformTitles(args: {
  projectId: string;
  input: LongformTitleInput;
}): Promise<LongformTitlePackage> {
  const { projectId, input } = args;
  const client = getAnthropic();
  const system = LONGFORM_TITLE_SYSTEM_PROMPT.replace(
    "{{PRINCIPLES}}",
    JSON.stringify({ title: principles.title, channel: principles.channel, common_bans: principles.common_bans }, null, 2)
  );
  const text = titleInputToText(input);
  let totalCost = 0;

  const call = async (extra?: string) => {
    const r = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: extra ? `${text}\n\n${extra}` : text }],
    });
    const blocks = r.content.filter((b: { type: string }) => b.type === "text") as Array<{ type: "text"; text: string }>;
    totalCost += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.sonnet,
    });
    return parse(blocks.map((b) => b.text).join("").trim());
  };

  let result = await call();
  if (!result || dirtyCount(result) > 0) {
    const bad = result
      ? result.candidates
          .filter((c) => (c.violations?.length ?? 0) > 0)
          .map((c) => `"${c.title}" (${c.violations!.join(", ")})`)
          .join("; ")
      : "";
    const note = result
      ? `앞선 후보에서 원칙 위반이 잡혔다: ${bad}. 위반을 모두 없애고 후보 5개를 다시 조립하라. 앞 30자 안에 주 검색어를 넣고, 시점 표현과 묶음 표시어(총정리·몰아보기·N편·N가지 등)는 절대 쓰지 마라.`
      : "JSON 형식이 어긋났다. 지정된 JSON 만 정확히 다시 출력하라.";
    const retry = await call(note);
    if (retry && dirtyCount(retry) < dirtyCount(result)) result = retry;
  }
  if (!result) throw new Error("롱폼 제목 생성 실패 — 응답에서 JSON 을 못 찾았어요");

  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd: totalCost,
    meta: { kind: "longform-title" },
  });
  return { ...result, generatedAt: Date.now() };
}

// ── 직접 쓴 제목 검증 ────────────────────────────────────────────────────────
// 운영자가 쓴 제목을 원칙으로 진단한다. 코드 검사(기계적 위반)와 모델 진단(판단이 필요한
// 부분)을 합쳐 돌려준다. 원문을 갈아엎지 않고, 대안은 참고용으로만 최대 2개.
export async function reviewLongformTitle(args: {
  projectId: string;
  title: string;
  context?: string; // 구성(세그먼트) 요약 — 있으면 "본편이 약속을 주는가" 판정에 쓴다
}): Promise<LongformTitleReview> {
  const { projectId, context } = args;
  const title = (args.title ?? "").trim();
  if (!title) throw new Error("검증할 제목을 입력해주세요");

  const client = getAnthropic();
  const system = LONGFORM_TITLE_REVIEW_SYSTEM_PROMPT.replace(
    "{{PRINCIPLES}}",
    JSON.stringify(
      { title: principles.title, channel: principles.channel, common_bans: principles.common_bans },
      null,
      2
    )
  );
  const user = [`[검증할 제목]\n${title}`, context ? `\n[본편 구성]\n${context}` : ""]
    .filter(Boolean)
    .join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
  });
  const blocks = r.content.filter((b: { type: string }) => b.type === "text") as Array<{ type: "text"; text: string }>;
  const raw = blocks.map((b) => b.text).join("").trim();
  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd: anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.sonnet,
    }),
    meta: { kind: "longform-title-review" },
  });

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("제목 검증 실패 — 응답에서 JSON 을 못 찾았어요");
  let j: Json;
  try {
    j = JSON.parse(m[0]) as Json;
  } catch {
    throw new Error("제목 검증 JSON 파싱 실패");
  }

  const strList = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());

  const primaryKeyword = str(j.primary_keyword);
  const thumbnailText = str(j.thumbnail_text);
  // 코드 검사 — 모델 판단과 별개로 기계적으로 잡히는 것.
  const violations = [
    ...titleViolations(title, primaryKeyword),
    ...(thumbnailText ? thumbnailTextViolations(thumbnailText, title) : []),
  ];

  return {
    title,
    // 코드 검사에 걸린 게 있으면 모델이 pass 라 해도 revise 다(기계 판정 우선).
    verdict: violations.length > 0 || str(j.verdict) === "revise" ? "revise" : "pass",
    principlesCheck: boolMap(j.principles_check),
    screening: boolMap(j.screening),
    violations,
    issues: strList(j.issues),
    strengths: strList(j.strengths),
    primaryKeyword,
    keywordRationale: str(j.keyword_rationale),
    alternatives: (Array.isArray(j.alternatives) ? j.alternatives : [])
      .map((a) => {
        const o = (a ?? {}) as Json;
        return { title: str(o.title), why: str(o.why) };
      })
      .filter((a) => a.title.length > 0)
      .slice(0, 2),
    thumbnailText,
    titlePromise: str(j.title_promise),
    summary: str(j.summary),
    reviewedAt: Date.now(),
  };
}
