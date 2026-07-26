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
        // ★ 톤·문체·금지는 쇼츠 원칙이 기준이다. 진행자 멘트는 쇼츠 나레이션과 같은 말투여야
        // 하고, 쇼츠가 안 하는 짓(투자 조언·종목 추천)은 롱폼도 안 한다.
        쇼츠_기준_톤과_금지: {
          style: shortsPrinciples.style,
          마무리_방식: shortsPrinciples.structure.scene_7,
          설명: "롱폼 엔딩도 쇼츠 ⑦씬과 똑같다 — 질문의 답을 정보·사실로 닫는 게 전부. 투자 조언·종목 추천·계좌 이야기는 쇼츠에 없고 롱폼에도 없다.",
        },
        // 롱폼에만 있는 구조(길이 예산·연결·세그먼트 순서). 톤을 여기서 새로 정하지 않는다.
        opening: principles.opening,
        segment_order: principles.segment_order,
        bridge: principles.bridge,
        ending: principles.ending,
        structure_loop: principles.structure_loop,
        common_bans: principles.common_bans,
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

  // 진행자 길이 예산은 모델이 자주 무시한다(실측: 오프닝 15초·브리지 18초). 그래서
  // 길이 위반이 남아 있으면 "현재 글자 수 → 목표 글자 수"를 숫자로 못박아 최대 2회 더 조인다.
  const overLengthNote = (p: LongformScriptPackage, s: ScriptScreenResult): string => {
    const chars = (...t: string[]) => t.map((x) => (x ?? "").trim().length).reduce((a, b) => a + b, 0);
    const lines: string[] = [
      `앞선 대본이 진행자 길이 예산을 넘겼다: ${s.violations.join("; ")}.`,
      "진행자 구간은 무조건 짧아야 한다. 아래 목표 글자 수(공백 포함)에 맞춰 문장을 잘라라.",
      "내용을 지키려 하지 말고 길이를 지켜라 — 핵심 한 조각만 남기고 나머지는 버린다.",
      `· 오프닝 블록 A: 현재 ${chars(p.opening.blockAHook)}자 → 목표 18자 이하(한 문장)`,
      `· 오프닝 블록 B: 현재 ${chars(p.opening.blockBRoadmapLanding)}자 → 목표 20자 이하(한 문장)`,
    ];
    p.bridges.forEach((b, i) => {
      lines.push(
        `· 브리지 ${i + 1}: 현재 ${chars(b.emphasis, b.elevation, b.opening)}자 → 방점·승격·개방 합쳐 27자 이하`
      );
    });
    lines.push(`· 엔딩 파트 A: 현재 ${chars(p.ending.partAClose)}자 → 목표 21자 이하`);
    lines.push(`· 엔딩 파트 B: 현재 ${chars(p.ending.partBLanding)}자 → 목표 16자 이하`);
    lines.push("파트 C(구독 표준 문구)는 고정이니 건드리지 마라. 전체 JSON 을 다시 출력하라.");
    return lines.join("\n");
  };

  let pkg = await call();
  let screen = pkg ? screenScript(pkg, input.constituents.length) : null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (pkg && screen && screen.violations.length === 0) break;
    const note = pkg && screen
      ? screen.violations.some((v) => /초 초과|문장 초과/.test(v))
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

