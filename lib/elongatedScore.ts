// ============================================================================
// [확장판] 닫힌 채점표 — 이 7항목이 전부다. 여기 없는 근거로 감점하지 않는다.
// ----------------------------------------------------------------------------
// 열린 지시("문제를 지적하라")를 주면 목록에 없는 자기 기준(문체 취향·"더 나은 대안")으로
// 흠을 만들어낸다(2026-07-25 제목 검수기 사건). 그래서 6항목은 코드가 판정하고,
// 판단이 필요한 1항목(열린 고리)만 모델에 닫힌 질문으로 묻는다.
// 전 항목 통과면 총평은 "통과" 한 단어.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { CHAPTER_TOLERANCE, REQUIRED_BLOCK, TARGET_TOLERANCE, totalCharBudget } from "./elongated";
import { bodyChars, stripCardRefs } from "./elongatedFormat";
import { runFactCheck } from "./elongatedFactCheck";
import { BANNED, hasStockPick } from "./longformScreening";
import type { ElongatedPlan, ElongatedScore, FactCard } from "./types";

type Msg = {
  content: { type: string; text?: string }[];
  usage: { input_tokens: number; output_tokens: number };
};

// 항목 이름은 지시서 그대로. 순서를 바꾸거나 항목을 늘리지 마라.
export const SCORE_ITEMS = [
  "원본의 열린 고리가 롱폼에서도 유지되는가",
  "챕터 길이가 대체로 균등한가",
  "모든 사실 문장에 근거 표기가 있는가",
  "팩트 대조를 통과했는가",
  "시황·전망 문장이 없는가",
  `덧붙일 대목 중 '${REQUIRED_BLOCK}'이 최소 1개 있는가`,
  "목표 길이 안에 들어오는가",
] as const;

export interface ScoreInput {
  plan: ElongatedPlan;
  facts: FactCard[];
  sourceScenes: string[];
  targetSec: number;
}

// ── 코드가 판정하는 항목들 ───────────────────────────────────────────────────

/** ② 챕터 길이가 대체로 균등한가 — 평균 대비 ±30%(config). */
function evenChapters(plan: ElongatedPlan): { pass: boolean; evidence: string } {
  const lens = plan.chapters.map((c) => bodyChars(c.body ?? ""));
  const written = lens.filter((n) => n > 0);
  if (written.length < 2) return { pass: false, evidence: "본문이 아직 두 챕터도 안 됐어요" };
  const avg = written.reduce((a, b) => a + b, 0) / written.length;
  const bad = plan.chapters
    .map((c, i) => ({ c, len: lens[i] }))
    .filter((x) => x.len > 0 && Math.abs(x.len - avg) > avg * CHAPTER_TOLERANCE);
  return bad.length === 0
    ? { pass: true, evidence: `평균 ${Math.round(avg)}자, 전 챕터가 ±${Math.round(CHAPTER_TOLERANCE * 100)}% 안` }
    : {
        pass: false,
        evidence: bad.map((x) => `${x.c.index}번 ${x.len}자(평균 ${Math.round(avg)}자)`).join(", "),
      };
}

/** ③ 사실 문장에 근거 표기가 있는가 — 숫자가 든 문장은 카드 id 를 달아야 한다. */
function gradedFacts(plan: ElongatedPlan, sourceScenes: string[]): { pass: boolean; evidence: string } {
  const items = runFactCheck({ chapters: plan.chapters, facts: [], sourceScenes });
  // runFactCheck 는 카드를 안 주면 "인용 없는 숫자"를 전부 잡는다 — 원본에 있던 것은 제외된다.
  const bare = items.filter((i) => !i.cardId);
  return bare.length === 0
    ? { pass: true, evidence: "숫자·고유명사가 든 문장에 모두 근거 표기가 있어요" }
    : {
        pass: false,
        evidence: bare
          .slice(0, 5)
          .map((i) => `${i.chapter}번 "${i.token}"`)
          .join(", ") + (bare.length > 5 ? ` 외 ${bare.length - 5}건` : ""),
      };
}

/**
 * ⑤ 시황·전망·투자 조언 문장이 없는가 — 쇼츠와 같은 금지 규칙을 그대로 쓴다.
 * 단 "시점 표현"은 뺀다. 쇼츠에서 연도를 금지하는 이유는 영상이 낡아 보이기 때문인데,
 * 확장판 본문은 사실 카드가 말하는 과거 사건의 연도를 인용해야 한다(그게 근거다).
 * 실측에서 카드 인용 연도가 전부 탈락으로 잡혔다 — 항목 이름도 "시황·전망"이지 시점이 아니다.
 */
const SKIP_LABELS = new Set(["시점 표현"]);

function noForecast(plan: ElongatedPlan): { pass: boolean; evidence: string } {
  const hits: string[] = [];
  for (const c of plan.chapters) {
    const body = stripCardRefs(c.body ?? "");
    if (!body) continue;
    for (const b of BANNED) {
      if (SKIP_LABELS.has(b.label)) continue;
      const m = b.re.exec(body);
      if (m) hits.push(`${c.index}번 ${b.label}("${m[0]}")`);
    }
    if (hasStockPick(body)) hits.push(`${c.index}번 종목 추천·투자 조언`);
  }
  return hits.length === 0
    ? { pass: true, evidence: "금지 표현 없음" }
    : { pass: false, evidence: [...new Set(hits)].slice(0, 6).join(", ") };
}

/** ⑥ 반론이 최소 1개 있는가(켜 둔 것 기준). */
function hasRequiredBlock(plan: ElongatedPlan): { pass: boolean; evidence: string } {
  const n = plan.chapters.reduce(
    (a, c) => a + c.blocks.filter((b) => b.enabled && b.type === REQUIRED_BLOCK && b.factIds.length > 0).length,
    0
  );
  return n > 0
    ? { pass: true, evidence: `${REQUIRED_BLOCK} ${n}곳` }
    : { pass: false, evidence: `${REQUIRED_BLOCK}이 한 곳도 없어요` };
}

/** ⑦ 목표 길이 ±20%(config). */
function withinLength(plan: ElongatedPlan, targetSec: number): { pass: boolean; evidence: string } {
  const total = plan.chapters.reduce((a, c) => a + bodyChars(c.body ?? ""), 0);
  const budget = totalCharBudget(targetSec);
  const lo = Math.round(budget * (1 - TARGET_TOLERANCE));
  const hi = Math.round(budget * (1 + TARGET_TOLERANCE));
  return total >= lo && total <= hi
    ? { pass: true, evidence: `${total}자 (목표 ${budget}자)` }
    : { pass: false, evidence: `${total}자 — 목표 ${budget}자의 ${lo}~${hi}자를 벗어났어요` };
}

// ── 모델이 판정하는 항목(①) ─────────────────────────────────────────────────
// 닫힌 질문 하나만 던진다. "문제를 찾아라"라고 하지 않는다.
const LOOP_SYSTEM = `너는 채점표 한 항목만 판정하는 검수기다. 아래 질문에만 답하고, 다른 지적을 하지 마라.

질문: 원본이 연 질문의 답이, 지정된 챕터보다 앞에서 새어 나갔는가?

판정 규칙:
- 답이 지정 챕터 전에 명시적으로 나오면 탈락.
- 단서를 쌓는 것은 누출이 아니다. 답을 문장으로 말했을 때만 누출이다.
- 지정 챕터에서 답이 실제로 닫히지 않아도 탈락.

출력은 JSON 만: {"pass":true|false,"evidence":"근거가 되는 본문 문구를 그대로 인용(통과면 닫는 문장을 인용)"}
문체 지적·대안 제시·다른 항목 언급 금지.`;

async function checkOpenLoop(args: {
  projectId: string;
  plan: ElongatedPlan;
}): Promise<{ pass: boolean; evidence: string; costUsd: number }> {
  const { projectId, plan } = args;
  const written = plan.chapters.filter((c) => (c.body ?? "").trim());
  if (written.length === 0) return { pass: false, evidence: "본문이 아직 없어요", costUsd: 0 };

  const user = [
    `[원본이 연 질문] ${plan.openLoop.question}`,
    `[답을 닫기로 한 챕터] ${plan.openLoop.closesAtChapter}번`,
    "",
    ...written.map((c) => `[${c.index}번 ${c.title}]\n${stripCardRefs(c.body ?? "")}`),
  ].join("\n");

  try {
    const client = getAnthropic();
    const r = (await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 1000,
      system: LOOP_SYSTEM,
      messages: [{ role: "user", content: user }] as never,
    })) as unknown as Msg;
    const costUsd = anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      model: MODELS.sonnet,
    });
    await recordCost({
      projectId,
      vendor: "anthropic",
      model: MODELS.sonnet,
      costUsd,
      meta: { kind: "elongated-score" },
    }).catch(() => {});
    const raw = r.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { pass: false, evidence: "판정을 받지 못했어요", costUsd };
    const j = JSON.parse(m[0]) as { pass?: unknown; evidence?: unknown };
    return {
      pass: j.pass === true,
      evidence: typeof j.evidence === "string" ? j.evidence.trim() : "",
      costUsd,
    };
  } catch {
    return { pass: false, evidence: "판정에 실패했어요 — 다시 시도해주세요", costUsd: 0 };
  }
}

// ── 채점 ─────────────────────────────────────────────────────────────────────

export async function scoreElongated(args: {
  projectId: string;
  input: ScoreInput;
}): Promise<ElongatedScore> {
  const { projectId, input } = args;
  const { plan, facts, sourceScenes, targetSec } = input;

  const loop = await checkOpenLoop({ projectId, plan });
  const fc = runFactCheck({ chapters: plan.chapters, facts, sourceScenes });

  const results = [
    { pass: loop.pass, evidence: loop.evidence },
    evenChapters(plan),
    gradedFacts(plan, sourceScenes),
    fc.length === 0
      ? { pass: true, evidence: "본문의 숫자·고유명사가 모두 카드나 원본에 있어요" }
      : {
          pass: false,
          evidence:
            fc
              .slice(0, 5)
              .map((i) => `${i.chapter}번 "${i.token}" ${i.verdict}`)
              .join(", ") + (fc.length > 5 ? ` 외 ${fc.length - 5}건` : ""),
        },
    noForecast(plan),
    hasRequiredBlock(plan),
    withinLength(plan, targetSec),
  ];

  const items = results.map((r, i) => ({
    no: i + 1,
    label: SCORE_ITEMS[i],
    pass: r.pass,
    evidence: r.evidence,
  }));
  const failed = items.filter((i) => !i.pass);

  return {
    items,
    // 전 항목 통과면 "통과" 한 단어. 아니면 탈락한 번호만 짚는다.
    summary: failed.length === 0 ? "통과" : `${failed.map((f) => f.no).join(", ")}번 탈락`,
    scoredAt: Date.now(),
  };
}
