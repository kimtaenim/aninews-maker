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
import { bodyChars } from "./elongatedFormat";
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

export async function generateChapterBody(args: {
  projectId: string;
  chapter: ElongatedChapter;
  plan: ElongatedPlan;
  sourceScenes: string[];
  facts: FactCard[];
  targetSec: number;
  previousTail?: string;
}): Promise<{ body: string; costUsd: number }> {
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

  const r = (await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: user }] as never,
  })) as unknown as Msg;
  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.sonnet,
  });

  const body = textOf(r);
  if (!body) throw new Error(`${chapter.index}번 챕터 본문을 받지 못했어요`);

  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd,
    meta: { kind: "elongated-body", chapter: chapter.index, chars: bodyChars(body) },
  }).catch(() => {});

  return { body, costUsd };
}
