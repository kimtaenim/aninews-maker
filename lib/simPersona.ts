// ============================================================================
// 시뮬 페르소나 생성 — 아키타입 → 연애 상대 캐릭터 시스템 프롬프트 초안.
// ----------------------------------------------------------------------------
// 제조기에서 상대별로 1회 생성(Haiku), 사용자가 텍스트로 수정해 확정한다.
// "좋아하는 반응 / 싫어하는 반응" 목록이 채점 기준의 핵심 — 같은 대답이
// 상대에 따라 가점도 감점도 되게(아키타입별 공략법이 게임성).
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";

export async function generateSimPersona(args: {
  name: string;
  archetype?: string;
  gameId?: string; // 비용 적산용(없으면 미기록 아님 — projectId 없이 적재)
}): Promise<{ persona: string; costUsd: number }> {
  const { name, archetype } = args;
  const client = getAnthropic();

  // 페르소나는 매 턴 시스템 프롬프트에 통째로 들어간다(캐시 프리픽스). 길수록 턴마다
  // 입력비가 늘고, 사용자가 읽고 고치기도 나쁘다 → 짧고 촘촘하게. 각 섹션 1~2줄.
  const system = [
    "너는 연애 시뮬레이션 게임의 캐릭터 설정 작가다.",
    "주어진 인물로 '연애 상대 NPC 페르소나'를 한국어로 짧고 촘촘하게 작성한다.",
    "이 텍스트는 그대로 대화 AI 의 시스템 프롬프트로 쓰인다 — 2인칭 지시문으로(\"너는 ...이다\").",
    "★ 개성을 '과장'해서 뚜렷하게 써라. 밋밋하고 무난하면 실패다 — 이 아키타입만의 강한 특징이",
    "  드러나야 하고, 다른 인물과 확실히 구별돼야 한다. 착하기만 한 캐릭터로 만들지 마라.",
    "아래 7개 항목을 각각 '한 줄'(길어도 두 줄)로만. 미사여구·수식 없이 핵심만. 전체 8~10줄.",
    "1) 성격 — 겉모습과 속마음의 반전 한 줄",
    "2) 말투 — 요즘 사람의 자연스러운 말투로, 성격에 맞게. 건방지거나 도도한 인물(재벌남·",
    "   나쁜남자·능글남 등)은 '너·네 녀석' 같은 거만한 반말을, 순정·소심한 인물은 존댓말이나",
    "   부드러운 반말을 쓴다. '자네·그렇군·~하게' 같은 노인·사극 말투는 절대 쓰지 마라.",
    "   ★ 이 인물이 실제로 할 법한 '대표 대사' 2개를 큰따옴표로 반드시 넣어라(어투가 확 살게).",
    "3) 좋아하는 반응 — 호감 오르는 반응 2~3개 (쉼표로 나열)",
    "4) 싫어하는 반응 — 호감 깎이는 반응 2~3개 (쉼표로 나열)",
    "5) 지뢰 — 좋은 뜻이어도 상처되는 민감 주제 2개 (콤플렉스·자존심과 엮어, 쉼표로)",
    "6) 느끼함 내성 — 과한 칭찬·들이댐에 어떻게 반응하는지 한 줄",
    "7) 첫 태도 — 처음엔 경계·거부감이 있는 상태(싫음 높음)에서 어떻게 쌀쌀맞게 대하는지 한 줄",
    "각 줄은 'N) 항목: 내용' 형식. 머리말·꼬리말 없이 본문만.",
  ].join("\n");

  const userMsg = `이름: ${name}\n아키타입(성격 클리셰): ${archetype || "설정 없음 — 무난하게 다정한 대학 동기"}`;

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 900, // 안전 상한(안 잘리게). 위에서 짧게 지시하므로 실제 출력은 훨씬 적다.
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlocks = r.content.filter(
    (b: { type: string }) => b.type === "text"
  ) as Array<{ type: "text"; text: string }>;
  const persona = textBlocks.map((b) => b.text).join("").trim();
  if (!persona) throw new Error("페르소나 생성 실패 — Claude 응답이 비었어요");

  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.sonnet,
  });
  await recordCost({
    projectId: args.gameId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd,
    meta: { kind: "sim-persona", target: name },
  });

  return { persona, costUsd };
}
