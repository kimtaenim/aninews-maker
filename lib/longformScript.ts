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
import { screenScript, type ScriptScreenResult } from "./longformScreening";
import principles from "../config/longform-principles.json";
// ★ 진행자 멘트의 톤·금지는 쇼츠 원칙을 그대로 따른다(2026-07-25 사용자 지정).
// 롱폼용으로 따로 만든 "계좌 착지" 원칙이 약장수 멘트를 부르는 통로였다 — 쇼츠는 그런 원칙
// 없이 잘 굴러가므로, 사본을 만들지 말고 쇼츠 파일을 그대로 읽어 주입한다.
import shortsPrinciples from "../config/script-principles.json";
import eyecatchConfig from "../config/eyecatch.json";
import type { LongformBridge, LongformScriptPackage } from "./types";
import type { LongformConstituent } from "./longformTitleGen";

// ★ 구독 표준 문구는 쇼츠 것을 그대로 쓴다(config/script-principles.json 의 ⑧씬 고정 문구).
// 롱폼용으로 따로 지어내지 마라 — 채널 문구는 하나다(2026-07-25 사고: 임의로 새 문구를 만들었음).
export const PART_C_STANDARD: string = shortsPrinciples.structure.scene_8.text;

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
  // ★ 쇼츠 원칙 전문을 그대로 준다(발췌·재서술 금지 — 그 과정에서 내가 원칙을 지어냈다).
  const system = LONGFORM_SCRIPT_SYSTEM_PROMPT.replace(
    "{{SHORTS}}",
    JSON.stringify(shortsPrinciples, null, 2)
  )
    .replace(
      "{{LONGFORM}}",
      // 롱폼에만 있는 것 = 세그먼트 순서 설계뿐. 톤·금지·마무리는 위 쇼츠 원칙이 다룬다.
      JSON.stringify({ segment_order: principles.segment_order }, null, 2)
    )
    .replace("{{MASCOT}}", mascot);
  const text = scriptInputToText(input);
  let totalCost = 0;

  const call = async (extra?: string): Promise<LongformScriptPackage | null> => {
    const r = await client.messages.create({
      model: MODELS.sonnet,
      // 세그먼트 20~30편이면 연결도 그만큼 나온다 — 출력이 잘리지 않게 넉넉히.
      max_tokens: 16000,
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

  // 씬 하나는 쇼츠 씬과 같은 4~7초 = 18~32자. 넘치면 그 씬만 현재/목표 글자 수로 지적한다.
  const SCENE_CHAR_MAX = 32; // 7초 × 4.5자/초 × 1.2배 ≈ 38자, 여유 두고 32자
  const overLengthNote = (p: LongformScriptPackage, s: ScriptScreenResult): string => {
    const n = (...t: string[]) => t.map((x) => (x ?? "").trim().length).reduce((a, b) => a + b, 0);
    const lines: string[] = [
      `앞선 대본에서 씬 길이가 넘쳤다: ${s.violations.join("; ")}.`,
      `진행자 씬 하나는 쇼츠 씬과 같은 4~7초다 — 씬당 ${SCENE_CHAR_MAX}자 이하(공백 포함).`,
      "단, 말을 토막 내지 마라. 담는 내용을 줄여서 짧게 만들되 문장은 자연스럽게 유지한다.",
    ];
    const over = (label: string, len: number) =>
      len > SCENE_CHAR_MAX ? lines.push(`· ${label}: 현재 ${len}자 → ${SCENE_CHAR_MAX}자 이하`) : 0;
    over("오프닝 1씬", n(p.opening.blockAHook));
    over("오프닝 2씬", n(p.opening.blockBRoadmapLanding));
    p.bridges.forEach((b, i) => over(`연결 ${i + 1}`, n(b.emphasis, b.elevation, b.opening)));
    over("엔딩 답", n(p.ending.partAClose));
    over("엔딩 여운", n(p.ending.partBLanding));
    lines.push("파트 C(구독 표준 문구)는 고정이니 건드리지 마라. 전체 JSON 을 다시 출력하라.");
    return lines.join("\n");
  };

  let pkg = await call();
  let screen = pkg ? screenScript(pkg, input.constituents.length) : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (pkg && screen && screen.violations.length === 0) break;
    const note = pkg && screen
      ? screen.violations.some((v) => /상한.*초과/.test(v))
        ? overLengthNote(pkg, screen)
        : `앞선 대본에서 원칙 위반이 잡혔다: ${screen.violations.join("; ")}. 지적된 부분만 고쳐 전체 JSON 을 다시 출력하라.`
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

