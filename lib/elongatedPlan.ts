// ============================================================================
// [확장판] 확장 설계 — 챕터 배치(1단계) + 사실 카드(2단계, 웹 검색).
// ----------------------------------------------------------------------------
// 본문을 바로 쓰지 않는다. 설계서를 먼저 만들고 화면에서 멈춘다(동의 게이트).
// 한 요청에 설계 + 전 사실 검색을 몰면 5분 20초가 걸려 Vercel maxDuration(300초)을
// 넘긴다(2026-07-26 실측). 그래서 둘로 쪼갠다:
//   1) generateElongatedPlan  — 검색 없음. 챕터·대목·검색어까지. 빠르다.
//   2) findBlockFacts         — 대목 하나의 사실만 web_search 로 확인해 카드로.
// 사실은 반드시 검색으로 확인한 것만 카드가 된다(URL 없는 것은 코드가 버린다) —
// 지어낸 사실이 본문으로 새는 유일한 통로를 막는 자리다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import {
  ELONGATED_FACT_SYSTEM_PROMPT,
  ELONGATED_PLAN_SYSTEM_PROMPT,
  FACT_EXTRACT_INSTRUCTION,
} from "./elongatedPlanPrompt";
import {
  BLOCK_TYPES,
  FACT_EXTRACT_MODEL,
  FACT_MODEL,
  GRADES,
  searchBudget,
  chapterCount,
} from "./elongated";
import { formatSeconds, multiplier } from "./elongatedFormat";
import { hasStockPick } from "./longformScreening";
import shortsPrinciples from "../config/script-principles.json";
import type { ElongatedBlock, ElongatedChapter, ElongatedPlan, FactCard } from "./types";

// SDK 세부 타입은 버전마다 흔들려 필요한 필드만 좁혀 쓴다(scriptCritique 와 동일).
type Block = { type: string; text?: string };
type Msg = {
  content: Block[];
  stop_reason?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};
type MsgParam = { role: "user" | "assistant"; content: unknown };

// 검색 결과가 토큰으로 들어와 매 턴 재전송되므로 검색 횟수가 곧 비용이다(실측 2026-07-26:
// max_uses 5·3라운드면 대목 하나에 5분·₩551). 예산은 대목 수에 비례 — config 단일 원천.
const webSearchTool = (blockCount: number) => ({
  type: "web_search_20260209",
  name: "web_search",
  max_uses: searchBudget(blockCount),
});
const MAX_ROUNDS = 2;
// 검색을 도는 모델(도구를 쓰므로 haiku 불가 — 400) 과 옮겨 적기만 하는 모델(도구 없음, 싸게).
const FACT_MODEL_ID = MODELS[FACT_MODEL];
const FACT_EXTRACT_MODEL_ID = MODELS[FACT_EXTRACT_MODEL];

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const textOf = (m: Msg | null): string =>
  (m?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const int = (v: unknown): number => Math.trunc(Number(v));

// ── 1단계: 설계(검색 없음) ───────────────────────────────────────────────────

export interface PlanInput {
  sourceTitle: string;
  sourceScenes: string[]; // 원본 나레이션(0-based 배열, 화면·프롬프트에선 1-based)
  sourceSeconds: number;
  targetSec: number;
  blockTypes: string[]; // 켜 둔 유형
}

export function planInputToText(input: PlanInput): string {
  const n = chapterCount(input.targetSec, input.sourceScenes.length);
  const lines: string[] = [];
  lines.push(`[원본 제목] ${input.sourceTitle}`);
  lines.push(
    `[목표 길이] ${formatSeconds(input.targetSec)} — 원본 ${formatSeconds(input.sourceSeconds)}의 약 ${multiplier(input.sourceSeconds, input.targetSec)}배`
  );
  lines.push(`[챕터 수] ${n}개 안팎으로 묶어라. 원본 씬 수(${input.sourceScenes.length})보다 많을 수 없다.`);
  lines.push(`[이번에 켠 덧붙일 대목 유형] ${input.blockTypes.join(", ")}`);
  lines.push("");
  lines.push("[원본 대본 — 씬 번호. 나레이션]");
  input.sourceScenes.forEach((s, i) => lines.push(`${i + 1}. ${(s ?? "").trim()}`));
  return lines.join("\n");
}

/**
 * 설계 JSON → 챕터 배치. 모델이 흔들려도 코드가 잡는다:
 *  · 켜 두지 않은 유형의 대목은 버린다
 *  · 원본 씬 번호 범위를 벗어나면 버린다
 *  · 챕터 번호는 순서대로 다시 매긴다
 */
export function parsePlan(
  raw: string,
  opts: { sourceSceneCount: number; blockTypes: string[] }
): ElongatedPlan | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Json;
  try {
    j = JSON.parse(m[0]) as Json;
  } catch {
    return null;
  }

  const allowed = new Set(opts.blockTypes);
  const chapters: ElongatedChapter[] = [];
  for (const c of Array.isArray(j.chapters) ? j.chapters : []) {
    const o = (c ?? {}) as Json;
    const title = str(o.title);
    const scenes = (Array.isArray(o.source_scenes) ? o.source_scenes : [])
      .map((x) => int(x) - 1) // 1-based → 0-based
      .filter((x) => Number.isInteger(x) && x >= 0 && x < opts.sourceSceneCount);
    if (!title && scenes.length === 0) continue;

    // 원본 씬을 하나도 안 품은 챕터는 버린다 — 모델이 자꾸 "마무리" 챕터를 만드는데,
    // 구독 문구는 씬으로 펼칠 때 자동으로 붙는다(빈 챕터가 32자짜리 본문을 만들었다).
    if (scenes.length === 0) continue;

    const blocks: ElongatedBlock[] = (Array.isArray(o.blocks) ? o.blocks : [])
      .map((b) => {
        const q = (b ?? {}) as Json;
        const query = str(q.query);
        return {
          type: str(q.type),
          need: str(q.need),
          ...(query ? { query } : {}),
          factIds: [],
          enabled: true,
        } as ElongatedBlock;
      })
      .filter((b) => allowed.has(b.type));

    chapters.push({
      index: chapters.length + 1,
      title: title || `챕터 ${chapters.length + 1}`,
      sourceSceneIndexes: scenes,
      role: str(o.role),
      blocks,
    });
  }
  if (chapters.length === 0) return null;

  const loop = (j.open_loop ?? {}) as Json;
  const closesAt = int(loop.closes_at_chapter);
  return {
    openLoop: {
      question: str(loop.question),
      // 답은 마지막 하나 앞에서 닫는 게 원칙 — 범위를 벗어나면 그 자리로 보정한다.
      closesAtChapter:
        Number.isInteger(closesAt) && closesAt >= 1 && closesAt <= chapters.length
          ? closesAt
          : Math.max(1, chapters.length - 1),
      closingLineHint: str(loop.closing_line_hint),
    },
    chapters,
    generatedAt: Date.now(),
  };
}

/**
 * 설계 단계 코드 검수 — 챕터 제목·대목이 투자 조언으로 기울면 여기서 잡는다.
 * 본문까지 가서 채점표가 잡으면 그 챕터를 통째로 다시 써야 한다(실측: "금을 볼 때 먼저
 * 확인할 숫자" 챕터가 그대로 조언 톤 본문이 됐다). 쇼츠와 같은 판정을 쓴다.
 */
export function screenPlan(plan: ElongatedPlan): string[] {
  const v: string[] = [];
  for (const c of plan.chapters) {
    const text = [c.title, c.role, ...c.blocks.map((b) => `${b.need} ${b.query ?? ""}`)].join(" ");
    if (hasStockPick(text)) v.push(`${c.index}번 "${c.title}" — 투자 조언·종목 추천 톤`);
  }
  return v;
}

export async function generateElongatedPlan(args: {
  projectId: string;
  input: PlanInput;
}): Promise<{ plan: ElongatedPlan; costUsd: number; violations: string[] }> {
  const { projectId, input } = args;
  const client = getAnthropic();

  const blockList = BLOCK_TYPES.filter((b) => input.blockTypes.includes(b.id))
    .map((b) => `  · ${b.id}: ${b.desc}`)
    .join("\n");
  const system = ELONGATED_PLAN_SYSTEM_PROMPT.replace(
    "{{SHORTS}}",
    JSON.stringify(shortsPrinciples, null, 2)
  ).replace("{{BLOCKS}}", blockList);

  const text = planInputToText(input);
  let costUsd = 0;

  const call = async (extra?: string): Promise<ElongatedPlan | null> => {
    const r = (await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: extra ? `${text}\n\n${extra}` : text }] as never,
    })) as unknown as Msg;
    costUsd += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.sonnet,
    });
    return parsePlan(textOf(r), {
      sourceSceneCount: input.sourceScenes.length,
      blockTypes: input.blockTypes,
    });
  };

  let plan = await call();
  if (!plan) throw new Error("설계를 받지 못했어요 — 다시 시도해주세요");
  let violations = screenPlan(plan);
  if (violations.length > 0) {
    // 투자 조언 톤이면 지적해 한 번만 다시 받는다. 나아지지 않으면 첫 설계를 쓰고 화면에 남긴다.
    const retry = await call(
      `앞선 설계에서 투자 조언 금지 위반이 잡혔다: ${violations.join("; ")}. ` +
        "시청자에게 무엇을 보라·확인하라·판단하라고 시키는 챕터나 대목을 만들지 마라. " +
        "그 자리를 원본이 이미 한 말의 근거·배경·사례·반론으로 바꿔 전체 JSON 을 다시 출력하라."
    );
    if (retry && screenPlan(retry).length < violations.length) {
      plan = retry;
      violations = screenPlan(retry);
    }
  }

  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd,
    meta: { kind: "elongated-plan", chapters: plan.chapters.length, violations: violations.length },
  }).catch(() => {});

  return { plan, costUsd, violations };
}

// ── 2단계: 대목 하나의 사실 찾기(웹 검색) ───────────────────────────────────

export interface FactSearchResult {
  // 대목 인덱스(0-based) → 그 대목에 붙일 사실. id 는 저장하는 쪽에서 이어 붙인다.
  byBlock: Map<number, Omit<FactCard, "id">[]>;
  missing: Map<number, string>;
  searched: boolean;
  report: string;
  costUsd: number;
}

/**
 * 확인 결과 JSON → 대목별 카드 후보.
 *  · URL 없는 사실은 버린다(검색 없이 지어낸 것으로 본다)
 *  · 같은 사실이 출처만 바꿔 여러 번 오면 하나만 남긴다(실측에서 실제로 나왔다)
 *  · 범위 밖 대목 번호는 버린다
 */
export function parseFacts(
  raw: string,
  opts: { blockCount: number; fetchedAt?: string }
): { byBlock: Map<number, Omit<FactCard, "id">[]>; missing: Map<number, string> } {
  const byBlock = new Map<number, Omit<FactCard, "id">[]>();
  const missing = new Map<number, string>();
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { byBlock, missing };
  let j: Json;
  try {
    j = JSON.parse(m[0]) as Json;
  } catch {
    return { byBlock, missing };
  }
  const fetchedAt = opts.fetchedAt ?? today();
  const seenFact = new Set<string>();

  for (const f of Array.isArray(j.facts) ? j.facts : []) {
    const o = (f ?? {}) as Json;
    const fact = str(o.fact);
    const url = str(o.source_url);
    const bi = int(o.block) - 1; // 화면·프롬프트는 1-based
    if (!fact || !/^https?:\/\//.test(url)) continue;
    if (!Number.isInteger(bi) || bi < 0 || bi >= opts.blockCount) continue;
    if (seenFact.has(fact)) continue; // 출처만 바꾼 중복
    seenFact.add(fact);
    const grade = str(o.grade);
    const card: Omit<FactCard, "id"> = {
      fact,
      grade: GRADES.includes(grade) ? grade : "추측",
      sourceUrl: url,
      sourceName: str(o.source_name),
      sourceDate: str(o.source_date),
      fetchedAt,
      expires: o.expires === true,
    };
    if (!byBlock.has(bi)) byBlock.set(bi, []);
    byBlock.get(bi)!.push(card);
  }

  for (const x of Array.isArray(j.missing) ? j.missing : []) {
    const o = (x ?? {}) as Json;
    const bi = int(o.block) - 1;
    const reason = str(o.reason);
    if (Number.isInteger(bi) && bi >= 0 && bi < opts.blockCount && reason) missing.set(bi, reason);
  }
  return { byBlock, missing };
}

/** 챕터 하나의 대목들이 요구하는 사실을 한 번에 확인한다(호출 수·비용을 줄이는 자리). */
export async function findChapterFacts(args: {
  projectId: string;
  context: { sourceTitle: string; chapterTitle: string; role: string };
  blocks: { type: string; need: string; query?: string }[];
}): Promise<FactSearchResult> {
  const { projectId, context, blocks } = args;
  const client = getAnthropic();

  const user = [
    `[영상 소재] ${context.sourceTitle}`,
    `[이 챕터] ${context.chapterTitle}${context.role ? ` — ${context.role}` : ""}`,
    "",
    "[덧붙일 대목들]",
    ...blocks.map(
      (b, i) =>
        `대목 ${i + 1} (${b.type}) — ${b.need}${b.query ? ` / 검색어 후보: ${b.query}` : ""}`
    ),
  ].join("\n");

  const messages: MsgParam[] = [{ role: "user", content: user }];
  let costUsd = 0;
  let searched = false;
  let last: Msg | null = null;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 검색이 도는 응답은 오래 걸린다 — 스트리밍으로 연결을 살려 둔다(비스트리밍은 타임아웃).
    const stream = client.messages.stream(
      {
        // 사실 확인은 판단이 아니라 수집이다 — Sonnet 으로 충분하고 훨씬 빠르다.
        model: FACT_MODEL_ID,
        max_tokens: 4000,
        system: ELONGATED_FACT_SYSTEM_PROMPT,
        tools: [webSearchTool(blocks.length)] as never,
        messages: messages as never,
      },
      { maxRetries: 0 }
    );
    const r = (await stream.finalMessage()) as unknown as Msg;
    costUsd += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: FACT_MODEL_ID,
    });
    if (r.content.some((b) => b.type === "web_search_tool_result" || b.type === "server_tool_use")) {
      searched = true;
    }
    last = r;
    if (r.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: r.content });
      continue;
    }
    break;
  }

  const report = textOf(last);
  // 검색이 안 돌았으면 사실이 전부 기억에서 나온 것이다 — 카드로 만들지 않는다.
  if (!searched) {
    await recordCost({
      projectId,
      vendor: "anthropic",
      model: FACT_MODEL_ID,
      costUsd,
      meta: { kind: "elongated-facts", searched: false },
    }).catch(() => {});
    const missing = new Map<number, string>();
    blocks.forEach((_, i) => missing.set(i, "웹 검색이 돌지 않아 확인하지 못했어요"));
    return { byBlock: new Map(), missing, searched: false, report, costUsd };
  }

  // 옮겨 적기(도구 없음, 짧고 저렴) — 검색이 도는 호출에 JSON 까지 시키면 형식이 깨진다.
  const ex = (await client.messages.create({
    model: FACT_EXTRACT_MODEL_ID,
    max_tokens: 4000,
    system: "너는 확인 결과를 구조화된 JSON 으로 옮겨 적는 변환기다. JSON 만 출력한다.",
    messages: [{ role: "user", content: `[확인 결과]\n${report}\n\n${FACT_EXTRACT_INSTRUCTION}` }] as never,
  })) as unknown as Msg;
  costUsd += anthropicCostUsd({
    inputTokens: ex.usage.input_tokens,
    outputTokens: ex.usage.output_tokens,
    model: FACT_EXTRACT_MODEL_ID,
  });

  const parsed = parseFacts(textOf(ex), { blockCount: blocks.length });
  // 사실도 못 찾고 사유도 안 적힌 대목은 "못 찾음"으로 채운다 — 빈칸으로 통과시키지 않는다.
  blocks.forEach((_, i) => {
    if (!parsed.byBlock.get(i)?.length && !parsed.missing.get(i)) {
      parsed.missing.set(i, "쓸 만한 사실을 못 찾았어요");
    }
  });

  const total = [...parsed.byBlock.values()].reduce((a, b) => a + b.length, 0);
  await recordCost({
    projectId,
    vendor: "anthropic",
    model: FACT_MODEL_ID,
    costUsd,
    meta: { kind: "elongated-facts", blocks: blocks.length, facts: total, searched: true },
  }).catch(() => {});

  return { byBlock: parsed.byBlock, missing: parsed.missing, searched: true, report, costUsd };
}

// ── 설계 상태 요약 ───────────────────────────────────────────────────────────

/** 아직 사실을 안 찾은 대목(켜 둔 것만) — 화면의 남은 건수 표시용. */
export function pendingBlocks(plan: ElongatedPlan): { chapter: number; block: number }[] {
  const out: { chapter: number; block: number }[] = [];
  plan.chapters.forEach((c) =>
    c.blocks.forEach((b, bi) => {
      if (b.enabled && !b.searchedAt) out.push({ chapter: c.index, block: bi });
    })
  );
  return out;
}

/** 사실 찾기를 돌려야 하는 챕터 번호들 — 검색은 챕터 단위로 묶어 부른다(호출 수·비용). */
export function pendingChapters(plan: ElongatedPlan): number[] {
  return plan.chapters
    .filter((c) => c.blocks.some((b) => b.enabled && !b.searchedAt))
    .map((c) => c.index);
}

/**
 * 근거를 하나도 못 채운 대목(켜 둔 것만) — 설계서의 "부족한 사실 n건".
 * missing 부기가 있어도 카드가 붙었으면 부족이 아니다 — 모델은 "이 세부는 못 찾았다"는
 * 메모를 자주 남기는데(실측), 그걸 전부 부족으로 세면 멀쩡한 대목까지 경고가 붙는다.
 */
export function missingBlocks(
  plan: ElongatedPlan
): { chapter: number; type: string; missing: string }[] {
  const out: { chapter: number; type: string; missing: string }[] = [];
  for (const c of plan.chapters) {
    for (const b of c.blocks) {
      if (!b.enabled || !b.searchedAt) continue;
      if (b.factIds.length === 0) {
        out.push({
          chapter: c.index,
          type: b.type,
          missing: b.missing || "근거로 쓸 사실을 못 찾았어요",
        });
      }
    }
  }
  return out;
}
