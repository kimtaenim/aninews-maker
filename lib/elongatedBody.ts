// ============================================================================
// [확장판] 본문 생성 — 챕터 단위. 설계 승인 뒤에만 돈다(동의 게이트).
// ----------------------------------------------------------------------------
// 사실 카드에 없는 숫자·고유명사를 새로 들이지 못하게 하고, 문장마다 근거 카드 id 를 달게
// 한다(렌더 전에 지운다). 실제 검사는 팩트 대조(lib/elongatedFactCheck.ts)가 기계로 한다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { ELONGATED_BODY_SYSTEM_PROMPT } from "./elongatedBodyPrompt";
import { chapterCharBudget } from "./elongated";
import { bodyChars, stripCardRefs } from "./elongatedFormat";
import { runFactCheck } from "./elongatedFactCheck";
import { BANNED, hasStockPick } from "./longformScreening";
import shortsPrinciples from "../config/script-principles.json";
import type { ElongatedChapter, ElongatedPlan, FactCard } from "./types";

type Msg = {
  content: { type: string; text?: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

const textOf = (m: Msg): string =>
  m.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();

// 본문 텍스트 규칙(근거 표시 제거·글자 수)은 화면도 써야 하므로 순수 모듈에 두고 다시 내보낸다.
export { CARD_REF, stripCardRefs, citedCardIds, bodyChars } from "./elongatedFormat";

export function chapterInputToText(args: {
  chapter: ElongatedChapter;
  plan: ElongatedPlan;
  sourceScenes: string[];
  facts: FactCard[];
  charBudget: number;
  previousTail?: string; // 앞 챕터 끝부분 — 같은 말을 반복하지 않게
}): string {
  const { chapter, plan, sourceScenes, facts, charBudget, previousTail } = args;
  const cardById = new Map(facts.map((f) => [f.id, f]));
  const usable = chapter.blocks.filter((b) => b.enabled && b.factIds.length > 0);
  const closes = plan.openLoop.closesAtChapter === chapter.index;

  const lines: string[] = [];
  lines.push(`[이 챕터] ${chapter.index}. ${chapter.title}`);
  if (chapter.role) lines.push(`[이 챕터가 하는 일] ${chapter.role}`);
  lines.push(`[열린 고리] ${plan.openLoop.question}`);
  lines.push(
    closes
      ? `[고리] 이 챕터에서 답을 닫는다. ${plan.openLoop.closingLineHint}`
      : "[고리] 이 챕터는 답을 말하지 않는다. 단서만 쌓고 열어 둔다."
  );
  lines.push(`[목표 글자 수] ${charBudget}자 안팎(공백 포함, 근거 표시 제외)`);
  if (previousTail) lines.push(`\n[앞 챕터 마지막 부분 — 이어지게만 쓰고 반복하지 마라]\n${previousTail}`);

  lines.push("\n[이 챕터가 품는 원본 대본 — 뼈대. 뒤집지 마라]");
  chapter.sourceSceneIndexes.forEach((i) => {
    const s = sourceScenes[i];
    if (s) lines.push(`- ${s.trim()}`);
  });

  if (usable.length) {
    lines.push("\n[덧붙일 대목 — 각각 아래 카드를 근거로]");
    usable.forEach((b) => {
      lines.push(`· ${b.type} — ${b.need}`);
      b.factIds.forEach((id) => {
        const c = cardById.get(id);
        if (c) lines.push(`    [${c.id}] (${c.grade}) ${c.fact}`);
      });
    });
  }

  const off = chapter.blocks.filter((b) => !b.enabled || b.factIds.length === 0);
  if (off.length) {
    lines.push(
      `\n[쓰지 않을 대목] ${off.map((b) => b.type).join(", ")} — 근거가 없거나 껐다. 이 내용은 쓰지 마라.`
    );
  }

  lines.push("\n[쓸 수 있는 사실 카드는 위에 나온 것뿐이다. 없는 숫자·고유명사를 만들지 마라.]");
  return lines.join("\n");
}

/**
 * 쓴 본문을 코드로 검수한다 — 채점표가 쓰는 것과 같은 판정이다.
 * 프롬프트로 금지해도 카드 밖 숫자가 새고(실측 5건), 투자 조언 톤이 남는다. 채점표에서
 * 잡으면 그 챕터를 통째로 다시 써야 하므로, 쓴 직후에 지적해 한 번 고쳐 받는다.
 */
export function screenBody(args: {
  chapter: ElongatedChapter;
  body: string;
  facts: FactCard[];
  sourceScenes: string[];
}): string[] {
  const { chapter, body, facts, sourceScenes } = args;
  const v: string[] = [];

  const bad = runFactCheck({
    chapters: [{ ...chapter, body }],
    facts,
    sourceScenes,
  });
  for (const it of bad.slice(0, 8)) {
    v.push(`"${it.token}" — ${it.verdict}${it.cardId ? ` (인용: ${it.cardId})` : " (근거 표시 없음)"}`);
  }

  const clean = stripCardRefs(body);
  for (const b of BANNED) {
    // 시점 표현은 뺀다 — 카드가 말하는 과거 연도는 인용해야 한다(채점표 ⑤와 같은 기준).
    if (b.label === "시점 표현") continue;
    const m = b.re.exec(clean);
    if (m) v.push(`금지 표현 ${b.label}("${m[0]}")`);
  }
  if (hasStockPick(clean)) v.push("투자 조언·종목 추천 — 시청자에게 판단을 시키는 말");
  return v;
}

export async function generateChapterBody(args: {
  projectId: string;
  chapter: ElongatedChapter;
  plan: ElongatedPlan;
  sourceScenes: string[];
  facts: FactCard[];
  targetSec: number;
  previousTail?: string;
}): Promise<{ body: string; costUsd: number; violations: string[] }> {
  const { projectId, chapter, plan, sourceScenes, facts, targetSec, previousTail } = args;
  const client = getAnthropic();
  const charBudget = chapterCharBudget(targetSec, plan.chapters.length);

  const system = ELONGATED_BODY_SYSTEM_PROMPT.replace(
    "{{SHORTS}}",
    JSON.stringify(shortsPrinciples, null, 2)
  );
  const user = chapterInputToText({
    chapter,
    plan,
    sourceScenes,
    facts,
    charBudget,
    previousTail,
  });

  let costUsd = 0;
  const call = async (extra?: string): Promise<string> => {
    const r = (await client.messages.create({
      model: MODELS.sonnet,
      max_tokens: 8000,
      system,
      messages: [{ role: "user", content: extra ? `${user}\n\n${extra}` : user }] as never,
    })) as unknown as Msg;
    costUsd += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.sonnet,
    });
    return textOf(r);
  };

  let body = await call();
  if (!body) throw new Error(`${chapter.index}번 챕터 본문을 받지 못했어요`);
  let violations = screenBody({ chapter, body, facts, sourceScenes });

  // 위반이 있으면 그것만 짚어 한 번 다시 받는다. 나아지지 않으면 첫 본문을 쓰고 화면에 남긴다.
  if (violations.length > 0) {
    const note = [
      `앞서 쓴 본문에서 다음이 걸렸다: ${violations.join("; ")}.`,
      "카드에 없는 숫자·고유명사는 지우거나, 숫자 없이 일반적인 설명으로 바꿔라. 새 숫자를 만들지 마라.",
      "사실을 말한 문장 끝에는 그 근거 카드 id 를 반드시 달아라.",
      "금지 표현은 문장을 다시 써서 없애라. 담는 내용을 줄여도 된다 — 말을 토막 내지는 마라.",
      // 물결표는 숫자 범위에서 되살아난다(실측: 재생성해도 남았다) — 어디서 쓰는지 못박는다.
      "물결표(~)는 숫자 범위에도 쓸 수 없다. 범위는 '얼마에서 얼마로'처럼 말로 풀어 써라.",
      // 고치면서 분량이 불어나면 챕터 균등 검수에 걸린다(실측: 617자가 826자가 됐다).
      `길이는 그대로 ${charBudget}자 안팎으로 유지하라. 고치면서 늘리지 마라.`,
      "본문 전체를 다시 출력하라(설명·머리말 없이 나레이션만).",
    ].join("\n");
    const retry = await call(note);
    if (retry) {
      const retryViolations = screenBody({ chapter, body: retry, facts, sourceScenes });
      if (retryViolations.length < violations.length) {
        body = retry;
        violations = retryViolations;
      }
    }
  }

  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd,
    meta: {
      kind: "elongated-body",
      chapter: chapter.index,
      chars: bodyChars(body),
      violations: violations.length,
    },
  }).catch(() => {});

  return { body, costUsd, violations };
}
