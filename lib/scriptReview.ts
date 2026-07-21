// ============================================================================
// 대본 구조 검수 — 8씬 대본을 열린 고리 원칙(config/script-principles.json)으로 진단·수정안.
// ----------------------------------------------------------------------------
// 대본 단계의 별도 "구조 검수" 버튼에서 호출(승인과 분리). 파이프라인 공용 Anthropic 클라이언트 재사용.
// JSON 파싱 실패면 1회 재시도. 위반이 있어도 pass=false 로 그대로 반환(사용자 동의 흐름은 UI).
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { SCRIPT_REVIEW_SYSTEM_PROMPT } from "./scriptReviewPrompt";
import principles from "../config/script-principles.json";

export interface LoopMapEntry {
  scene: number;
  status: string;
  note: string;
}
export interface RevisedScene {
  scene: number;
  original: string;
  revised: string;
  changed: boolean;
  reason: string;
}
export interface ScriptReviewResult {
  pass: boolean;
  loopMap: LoopMapEntry[];
  violations: string[];
  diagnosisSummary: string;
  consentQuestion: string;
  revisedScenes: RevisedScene[];
  costUsd: number;
}

// 대본 지문 — 저장된 다듬기 결과가 현재 대본과 같은지 판정(공백 정규화). 대본이 바뀌면
// 지문이 달라져 낡은 결과를 복원하지 않게 한다.
export function reviewFingerprint(narrations: string[]): string {
  return narrations.map((n) => (n ?? "").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}

// 대본을 ①-⑧ 로 직렬화(검수 입력).
export function scenesToReviewText(narrations: string[]): string {
  const circled = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
  return narrations.map((n, i) => `${circled[i] ?? `${i + 1}.`} ${(n ?? "").trim()}`).join("\n");
}

interface Parsed {
  pass?: unknown;
  loop_map?: unknown;
  violations?: unknown;
  diagnosis_summary?: unknown;
  consent_question?: unknown;
  revised_scenes?: unknown;
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}

export function parseReview(raw: string): ScriptReviewResult | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Parsed;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const loopMap: LoopMapEntry[] = Array.isArray(j.loop_map)
    ? j.loop_map.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return {
          scene: typeof o.scene === "number" ? o.scene : Number(o.scene) || 0,
          status: toStr(o.status),
          note: toStr(o.note),
        };
      })
    : [];
  const revisedScenes: RevisedScene[] = Array.isArray(j.revised_scenes)
    ? j.revised_scenes.map((e) => {
        const o = (e ?? {}) as Record<string, unknown>;
        return {
          scene: typeof o.scene === "number" ? o.scene : Number(o.scene) || 0,
          original: toStr(o.original),
          revised: toStr(o.revised),
          changed: o.changed === true,
          reason: toStr(o.reason),
        };
      })
    : [];
  return {
    pass: j.pass === true,
    loopMap,
    violations: Array.isArray(j.violations) ? j.violations.filter((v): v is string => typeof v === "string") : [],
    diagnosisSummary: toStr(j.diagnosis_summary),
    consentQuestion: toStr(j.consent_question) || "구조를 열린 고리로 수정해볼까요?",
    revisedScenes,
    costUsd: 0,
  };
}

export async function reviewScript(args: {
  projectId: string;
  narrations: string[];
}): Promise<ScriptReviewResult> {
  const { projectId, narrations } = args;
  const client = getAnthropic();
  const system = SCRIPT_REVIEW_SYSTEM_PROMPT.replace("{{PRINCIPLES}}", JSON.stringify(principles, null, 2));
  const scriptText = scenesToReviewText(narrations);
  let totalCost = 0;

  const call = async (extra?: string): Promise<ScriptReviewResult | null> => {
    const r = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: extra ? `${scriptText}\n\n${extra}` : scriptText }],
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
    return parseReview(raw);
  };

  let result = await call();
  if (!result) result = await call("JSON 형식이 어긋났다. 지정된 JSON 만 정확히 다시 출력하라.");
  if (!result) throw new Error("대본 검수 실패 — 응답에서 JSON 을 못 찾았어요");

  await recordCost({ projectId, vendor: "anthropic", model: MODELS.sonnet, costUsd: totalCost, meta: { kind: "script-review" } });
  result.costUsd = totalCost;
  return result;
}
