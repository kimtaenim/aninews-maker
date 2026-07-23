// ============================================================================
// [롱폼 모듈 2~4] 대본 트랙 생성 — 오프닝(2블록) · 세그먼트 순서 + 브리지 · 엔딩(3파트).
// ----------------------------------------------------------------------------
// 셋을 한 번에 생성한다 — 고리 일치(오프닝이 연 질문 = 엔딩이 닫는 질문)를 지키려면
// 따로 쓸 수 없기 때문. 모듈 1이 확정한 title/title_promise 를 기준점으로 받는다.
// 코드 검수(lib/longformScreening.ts)에서 위반이 잡히면 위반을 지적해 1회 재생성.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { LONGFORM_SCRIPT_SYSTEM_PROMPT } from "./longformScriptPrompt";
import { screenScript } from "./longformScreening";
import principles from "../config/longform-principles.json";
import eyecatchConfig from "../config/eyecatch.json";
import type { LongformBridge, LongformScriptPackage } from "./types";
import type { LongformConstituent } from "./longformTitleGen";

export const PART_C_STANDARD: string = principles.ending.part_c.standard_line;

export interface LongformScriptInput {
  title: string; // 확정 제목
  titlePromise: string; // 확정 제목이 약속한 괴리 — 전 구간의 기준점
  viewerPayoff: string;
  constituents: LongformConstituent[]; // 현재 순서
  fixedOrder?: boolean; // true면 사용자가 순서를 고정한 것 — 그대로 따르고 우려만 한 번 적는다
}

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v));

export function scriptInputToText(input: LongformScriptInput): string {
  const lines: string[] = [];
  lines.push(`[확정 제목] ${input.title}`);
  lines.push(`[title_promise] ${input.titlePromise}`);
  lines.push(`[viewer_payoff] ${input.viewerPayoff}`);
  lines.push(
    input.fixedOrder
      ? "[순서] 사용자가 아래 순서를 고정했다. 그대로 따르고, 우려가 있으면 order_note 에 한 번만 적어라."
      : "[순서] 아래는 현재 순서다. 유지율 관점에서 최적 배열을 제안하라."
  );
  lines.push("[구성 — index 는 현재 순서의 0-based 인덱스]");
  input.constituents.forEach((c, i) => {
    lines.push(
      `  index ${i}: ${c.title} — 소재: ${c.topic}${c.performance ? ` / 실적: ${c.performance}` : " / 실적: 미상"}`
    );
  });
  lines.push(`\n[파트 C 표준 문구] ${PART_C_STANDARD}`);
  return lines.join("\n");
}

function parse(raw: string, input: LongformScriptInput): LongformScriptPackage | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: Json;
  try {
    j = JSON.parse(m[0]) as Json;
  } catch {
    return null;
  }
  const n = input.constituents.length;

  // 세그먼트 순서 — index 가 0..n-1 의 순열이어야 채택, 아니면 현재 순서 유지.
  const rawOrder = (Array.isArray(j.segment_order) ? j.segment_order : []).map((o) => {
    const e = (o ?? {}) as Json;
    return { index: num(e.index), title: str(e.title), rationale: str(e.rationale) };
  });
  const idxs = rawOrder.map((o) => o.index).filter((x) => Number.isInteger(x));
  const isPerm =
    idxs.length === n && [...idxs].sort((a, b) => a - b).join(",") === Array.from({ length: n }, (_, i) => i).join(",");
  const orderIdx = input.fixedOrder || !isPerm ? Array.from({ length: n }, (_, i) => i) : idxs;
  const segmentOrder = orderIdx.map((srcIdx, pos) => {
    const c = input.constituents[srcIdx];
    const meta = rawOrder.find((o) => o.index === srcIdx);
    return {
      order: pos + 1,
      segmentId: c?.segmentId,
      title: c?.title ?? meta?.title ?? `#${srcIdx}`,
      rationale: meta?.rationale ?? "",
    };
  });

  const op = (j.opening ?? {}) as Json;
  const en = (j.ending ?? {}) as Json;
  const gaps = Math.max(0, n - 1);
  const bridges: LongformBridge[] = (Array.isArray(j.bridges) ? j.bridges : [])
    .map((b) => {
      const o = (b ?? {}) as Json;
      return {
        afterSegment: Number.isInteger(num(o.after_segment)) ? num(o.after_segment) : 0,
        emphasis: str(o["방점"]) || str(o.emphasis),
        elevation: str(o["승격"]) || str(o.elevation),
        opening: str(o["개방"]) || str(o.open),
        isMidpointReopen: o.is_midpoint_reopen === true,
        imagePrompt: str(o.image) || undefined,
      };
    })
    .filter((b) => b.emphasis || b.elevation || b.opening)
    .sort((a, b) => a.afterSegment - b.afterSegment)
    .slice(0, gaps)
    .map((b, i) => ({ ...b, afterSegment: i })); // 위치는 제안 순서의 i번째 뒤로 정규화

  const blockA = str(op.block_a_hook);
  const blockB = str(op.block_b_roadmap_landing);
  if (!blockA || !blockB) return null;

  const screening: Record<string, string> = {};
  if (j.screening && typeof j.screening === "object") {
    for (const [k, v] of Object.entries(j.screening as Json)) screening[k] = str(v);
  }

  return {
    titleUsed: input.title,
    titlePromise: input.titlePromise,
    segmentOrder,
    orderNote: str(j.order_note) || undefined,
    opening: {
      blockAHook: blockA,
      blockBRoadmapLanding: blockB,
      estSeconds: 0,
      imagePromptA: str(op.image_a) || undefined,
      imagePromptB: str(op.image_b) || undefined,
    },
    bridges,
    ending: {
      partAClose: str(en.part_a_close),
      partBLanding: str(en.part_b_landing),
      // 파트 C 는 롱폼 표준 문구 고정(모델이 흔들려도 여기서 확정).
      partCStandard: PART_C_STANDARD,
      endscreenVideo: str(en.endscreen_video),
      estSeconds: 0,
      imagePromptA: str(en.image_a) || undefined,
      imagePromptB: str(en.image_b) || undefined,
      imagePromptC: str(en.image_c) || undefined,
    },
    screening,
    generatedAt: Date.now(),
  };
}

export async function generateLongformScript(args: {
  projectId: string;
  input: LongformScriptInput;
}): Promise<{ pkg: LongformScriptPackage; violations: string[]; costUsd: number }> {
  const { projectId, input } = args;
  if (!input.titlePromise.trim()) {
    throw new Error("title_promise 가 없어요 — 모듈 1에서 제목을 먼저 확정해주세요");
  }
  const client = getAnthropic();
  const mascot = (eyecatchConfig as { description?: string }).description ?? "";
  const system = LONGFORM_SCRIPT_SYSTEM_PROMPT.replace(
    "{{PRINCIPLES}}",
    JSON.stringify(
      {
        opening: principles.opening,
        segment_order: principles.segment_order,
        bridge: principles.bridge,
        ending: principles.ending,
        style: principles.style,
        common_bans: principles.common_bans,
        structure_loop: principles.structure_loop,
      },
      null,
      2
    )
  ).replace("{{MASCOT}}", mascot);
  const text = scriptInputToText(input);
  let totalCost = 0;

  const call = async (extra?: string): Promise<LongformScriptPackage | null> => {
    const r = await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 4000,
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
    return parse(blocks.map((b) => b.text).join("").trim(), input);
  };

  let pkg = await call();
  let screen = pkg ? screenScript(pkg, input.constituents.length) : null;
  if (!pkg || (screen && screen.violations.length > 0)) {
    const note = pkg
      ? `앞선 대본에서 원칙 위반이 잡혔다: ${screen!.violations.join("; ")}. 지적된 부분만 고쳐 전체 JSON 을 다시 출력하라. 특히 25초 규칙은 글자 수로 맞춰라(5.4자/초 = 4.5×1.2배).`
      : "JSON 형식이 어긋났다. 지정된 JSON 만 정확히 다시 출력하라.";
    const retry = await call(note);
    const retryScreen = retry ? screenScript(retry, input.constituents.length) : null;
    if (retry && (!pkg || (retryScreen?.violations.length ?? 99) < (screen?.violations.length ?? 99))) {
      pkg = retry;
      screen = retryScreen;
    }
  }
  if (!pkg || !screen) throw new Error("롱폼 대본 생성 실패 — 응답에서 JSON 을 못 찾았어요");

  pkg.opening.estSeconds = screen.openingSeconds;
  pkg.ending.estSeconds = screen.endingSeconds;
  pkg.screening = { ...pkg.screening, ...screen.computed };

  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd: totalCost,
    meta: { kind: "longform-script" },
  });
  return { pkg, violations: screen.violations, costUsd: totalCost };
}

