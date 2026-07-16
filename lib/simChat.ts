// ============================================================================
// 시뮬 대화 판정 코어 — 상대가 상황을 던지고, 플레이어 반응을 채점한다.
// ----------------------------------------------------------------------------
// 핵심: affinityDelta 는 "플레이어의 직전 반응이 이 캐릭터(아키타입)가 좋아할
// 만한 반응이었나"로 정한다. 같은 대답도 상대에 따라 가점/감점이 갈린다.
// 랜덤 상황(팀 과제·오해 등)은 코드가 주사위를 굴려 시점·중복을 관리하고,
// Claude 는 받은 디렉터 지시를 자연스럽게 연기만 한다.
// 승패는 코드가 최종 게이트 — Claude 가 고백을 제안해도 친밀도 임계치로 검증한다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { pickSituation, rollNextSituationTurn, SIM_SITUATIONS } from "./simSituations";
import type { SimGame, SimPlay, SimTarget } from "./types";

const HISTORY_WINDOW = 20; // 최근 대화 턴(슬라이딩 윈도우) — 그 앞은 잘라 비용 관리
const NPC_CONFESS_MIN = 90; // 상대가 먼저 고백할 수 있는 최소 친밀도
const PLAYER_CONFESS_MIN = 75; // 플레이어 고백이 수락되는 최소 친밀도

// 페르소나 + 게임 규칙 = 캐시 가능한 안정 프리픽스. 매 턴 바뀌는 값(현재 친밀도·
// 상황 지시)은 시스템에 넣지 않고 마지막 user 메시지에 실어 프리픽스를 고정한다.
function buildSystem(target: SimTarget) {
  const rules = [
    "",
    "── 게임 규칙 (설정에 없더라도 반드시 지킬 것) ──",
    "너는 위 인물로서 플레이어(상대 유저)와 1:1 로 대화하는 연애 시뮬레이션의 상대다.",
    "매 답변은 짧게(2~4문장). 대화를 매번 끝맺지 말고, 플레이어가 반응할 거리를 남겨라 —",
    "질문을 던지거나, 고민을 털어놓거나, 성격대로 툭 시험하듯 말을 걸어라.",
    "",
    "매 턴, 플레이어의 '직전 메시지'를 다음 기준으로 채점해 affinityDelta(-10~+10 정수)를 정한다:",
    "· 내 성격(위 설정의 좋아하는/싫어하는 반응)에 맞는 반응인가 — 맞으면 +, 어긋나면 -.",
    "· 내가 던진 감정·상황을 잘 읽고 공감/재치있게 받았는가.",
    "· 성의 없는 단답('ㅇㅇ','그렇구나')·무관심·무례함은 감점.",
    "평상시엔 -5~+5, 마음이 크게 움직이거나 결정적 실수엔 ±10 까지.",
    "",
    "고백 판정(event):",
    "· 플레이어의 직전 메시지가 고백/사귀자는 뜻이면 event=\"player_confess\".",
    "· 서로 마음이 깊어져 네가 먼저 고백하고 싶을 만큼 무르익었을 때만 event=\"npc_confess\".",
    "  (아직 서먹하면 절대 먼저 고백하지 말 것.)",
    "· 그 외에는 event=null.",
    "",
    "반드시 아래 JSON 만 출력한다(다른 텍스트 금지):",
    '{"reply": "상대의 대사", "affinityDelta": 정수, "judge": "채점 이유 한 줄", "event": null 또는 "player_confess" 또는 "npc_confess"}',
  ].join("\n");

  return [
    {
      type: "text" as const,
      text: `너는 아래 인물을 연기한다.\n\n── 인물 설정 ──\n${target.persona}\n${rules}`,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

// 최근 HISTORY_WINDOW 턴을 Anthropic 메시지 배열로. (오프닝 assistant 턴 포함)
function toMessages(turns: SimPlay["turns"]) {
  return turns.slice(-HISTORY_WINDOW).map((t) => ({
    role: t.role,
    content: t.text,
  }));
}

function clampDelta(n: unknown): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(-10, Math.min(10, v));
}

function clampAffinity(n: number): number {
  return Math.max(0, Math.min(100, n));
}

// Claude 응답에서 JSON 한 덩이 추출(코드펜스·잡텍스트 방어).
function parseTurnJson(raw: string): {
  reply: string;
  affinityDelta: number;
  judge?: string;
  event?: string | null;
} | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const reply = typeof o.reply === "string" ? o.reply.trim() : "";
    if (!reply) return null;
    return {
      reply,
      affinityDelta: clampDelta(o.affinityDelta),
      judge: typeof o.judge === "string" ? o.judge : undefined,
      event: typeof o.event === "string" ? o.event : null,
    };
  } catch {
    return null;
  }
}

async function callHaiku(args: {
  system: ReturnType<typeof buildSystem>;
  messages: { role: "user" | "assistant"; content: string }[];
  gameId: string;
  kind: string;
}): Promise<{ raw: string }> {
  const client = getAnthropic();
  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 320,
    system: args.system,
    messages: args.messages,
  });
  const raw = (
    r.content.filter((b: { type: string }) => b.type === "text") as Array<{
      type: "text";
      text: string;
    }>
  )
    .map((b) => b.text)
    .join("")
    .trim();

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
    meta: { kind: args.kind },
  });
  return { raw };
}

// 오프닝 인사 — 세션 시작 시 상대가 먼저 말을 건다(친밀도 판정 없음).
export async function generateOpening(
  game: SimGame,
  target: SimTarget
): Promise<string> {
  const { raw } = await callHaiku({
    system: buildSystem(target),
    messages: [
      {
        role: "user",
        content:
          "(게임 시작 — 아직 서먹한 사이다. 위 '첫 태도'대로 플레이어에게 먼저 짧게 말을 걸고, 대화를 이어갈 여지를 남겨라. 이번엔 JSON 이 아니라 대사 한두 문장만 출력한다.)",
      },
    ],
    gameId: game.id,
    kind: "sim-opening",
  });
  // 오프닝은 평문 — 혹시 JSON 으로 답했으면 reply 만 꺼낸다.
  const asJson = parseTurnJson(raw);
  return asJson?.reply || raw || "…안녕.";
}

export interface JudgeResult {
  reply: string;
  affinityDelta: number;
  affinity: number;
  judge?: string;
  situationId?: string; // 이번 턴에 발동된 상황
  crossedMilestone?: number; // 이번 턴에 처음 넘은 마일스톤(25/50/75)
  ending?: "won" | "lost";
  endedReason?: string;
}

// 한 턴 판정 — play 는 '플레이어 메시지가 이미 turns 에 push 된' 상태로 넘긴다.
// (상황 발동 여부는 코드가 결정하고, 상태 변경분은 호출부가 저장한다.)
export async function judgeTurn(
  game: SimGame,
  target: SimTarget,
  play: SimPlay
): Promise<JudgeResult> {
  // 1) 상황 주사위 — assistant 턴 수가 예약 턴에 도달했고 안 쓴 상황이 남았으면 발동.
  const assistantTurns = play.turns.filter((t) => t.role === "assistant").length;
  let situationId: string | undefined;
  let directive = "";
  if (assistantTurns + 1 >= play.nextSituationAtTurn) {
    const situation = pickSituation(play.situationsUsed);
    if (situation) {
      situationId = situation.id;
      directive =
        `\n\n[연출 지시 — 플레이어에게 비밀] 이번 답변에서 다음 상황을 자연스럽게 시작하라: ` +
        `"${situation.label} — ${situation.direction}" 이 상황에 대한 플레이어의 반응은 평소보다 크게(±10) 채점한다.`;
    }
  }

  // 2) 현재 친밀도·고백 임계치·상황 지시를 마지막 user 메시지에 실어 프리픽스 고정.
  const messages = toMessages(play.turns);
  const gate =
    `\n\n[상태 — 플레이어에게 비밀] 현재 친밀도 ${play.affinity}/100. ` +
    `네가 먼저 고백(npc_confess)하려면 친밀도가 ${NPC_CONFESS_MIN} 이상으로 무르익어야 자연스럽다.`;
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    last.content = `${last.content}${gate}${directive}`;
  }

  const { raw } = await callHaiku({
    system: buildSystem(target),
    messages,
    gameId: game.id,
    kind: "sim-turn",
  });

  const parsed = parseTurnJson(raw);
  if (!parsed) {
    // 파싱 실패 — 대화는 이어가되 친밀도는 그대로.
    return {
      reply: raw || "…음, 뭐라고 해야 할지 모르겠어.",
      affinityDelta: 0,
      affinity: play.affinity,
    };
  }

  // 3) 친밀도 갱신 + 마일스톤 교차 검사.
  const affinity = clampAffinity(play.affinity + parsed.affinityDelta);
  const crossedMilestone = [25, 50, 75].find(
    (m) => play.affinity < m && affinity >= m && !play.milestonesSeen.includes(m)
  );

  // 4) 승패 코드 게이트 — Claude 제안을 임계치로 검증한다.
  let ending: "won" | "lost" | undefined;
  let endedReason: string | undefined;
  if (parsed.event === "player_confess") {
    if (affinity >= PLAYER_CONFESS_MIN) {
      ending = "won";
      endedReason = "고백 수락 — 마음이 통했다";
    } else {
      ending = "lost";
      endedReason = "고백 거절 — 아직 그 정도 사이는 아니었다";
    }
  } else if (parsed.event === "npc_confess" && affinity >= NPC_CONFESS_MIN) {
    ending = "won";
    endedReason = "상대의 고백을 받아냈다";
  }
  // npc_confess 인데 임계치 미달이면 무시(무르익지 않음) — 대화만 이어간다.

  return {
    reply: parsed.reply,
    affinityDelta: parsed.affinityDelta,
    affinity,
    judge: parsed.judge,
    situationId,
    crossedMilestone,
    ending,
    endedReason,
  };
}

// 다음 상황 예약 턴을 다시 굴린다(상황 발동 후 호출부가 사용).
export function rescheduleSituation(currentAssistantTurns: number): number {
  return rollNextSituationTurn(currentAssistantTurns);
}

// 전체 상황 개수 — 다 소진했는지 판단용(호출부에서 참고).
export const TOTAL_SITUATIONS = SIM_SITUATIONS.length;
