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

  const system = [
    "너는 연애 시뮬레이션 게임의 캐릭터 설정 작가다.",
    "주어진 인물로 '연애 상대 NPC 페르소나'를 한국어로 작성한다.",
    "이 텍스트는 그대로 대화 AI 의 시스템 프롬프트로 쓰인다 — 2인칭 지시문으로 쓸 것(\"너는 ...이다\").",
    "다음 섹션을 이 순서로, 각각 3~5줄 이내로 간결하게:",
    "1) 성격 — 아키타입의 겉모습과 속마음(반전 포인트 포함)",
    "2) 말투 — 어미·호칭·이모티콘 사용 여부 등 구체적으로",
    "3) 좋아하는 반응 — 친밀도가 오르는 플레이어의 반응 유형 3~4개 (예: 능청스럽게 받아치기)",
    "4) 싫어하는 반응 — 친밀도가 깎이는 반응 유형 3~4개 (예: 정면 돌직구, 성의 없는 단답)",
    "5) 첫 태도 — 아직 서먹한 사이(친밀도 20/100)에서 플레이어를 대하는 거리감",
    "머리말·꼬리말 없이 페르소나 본문만 출력한다.",
  ].join("\n");

  const userMsg = `이름: ${name}\n아키타입(성격 클리셰): ${archetype || "설정 없음 — 무난하게 다정한 대학 동기"}`;

  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 700,
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
    model: MODELS.haiku,
  });
  await recordCost({
    projectId: args.gameId,
    vendor: "anthropic",
    model: MODELS.haiku,
    costUsd,
    meta: { kind: "sim-persona", target: name },
  });

  return { persona, costUsd };
}
