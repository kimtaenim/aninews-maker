// ============================================================================
// 시뮬 대화 판정 코어 — 호감(장기) + 기분(실시간) 2축 감정 모델.
// ----------------------------------------------------------------------------
// 연애의 실제 동역학을 반영한다:
//  · 한 말이 호감+·기분- 를 동시에 줄 수 있다(느끼한 말: 은근 좋지만 부담스럽다).
//  · 지뢰(민감 주제)를 밟으면 좋은 말이라도 기분이 깎인다.
//  · 기분이 -25 밑으로 떨어지면 '삐짐' — 이땐 뭘 해도 호감이 안 오른다.
//    더 잘해주는 걸로는 못 푼다. 삐진 '이유를 정확히 짚어' 사과해야 풀린다.
//    두루뭉술 사과는 안 풀리고, 엉뚱한 걸 사과하면 기분이 더 나빠진다.
//    잘 화해하면 오히려 호감이 오른다(싸우고 화해하면 정든다).
//  · 방치해 기분이 바닥(-50)까지 가면 관계 파탄(패배).
// 승패·상태 전이는 코드가 최종 판정. Claude 는 채점값과 대사를 낼 뿐이다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { pickSituation, rollNextSituationTurn, SIM_SITUATIONS } from "./simSituations";
import type { SimGame, SimPlay, SimTarget } from "./types";

const HISTORY_WINDOW = 20; // 최근 대화 턴(슬라이딩 윈도우)
const NPC_CONFESS_MIN = 90; // 상대가 먼저 고백할 수 있는 최소 호감
const PLAYER_CONFESS_MIN = 75; // 플레이어 고백이 수락되는 최소 호감

const MOOD_MIN = -50;
const MOOD_MAX = 50;
const SULK_ENTER = -25; // 기분이 이 밑이면 삐짐 진입
const MOOD_BREAKUP = -50; // 기분 바닥 — 관계 파탄
const REPAIR_BONUS = 6; // 정확한 사과로 화해 시 호감 보너스

// 페르소나 + 게임 규칙 = 캐시 가능한 안정 프리픽스. 매 턴 바뀌는 상태(호감·기분·
// 삐짐·삐진 이유·상황 지시)는 시스템에 넣지 않고 마지막 user 메시지에 실어 고정.
function buildSystem(target: SimTarget) {
  const rules = [
    "",
    "── 게임 규칙 (설정에 없더라도 반드시 지킬 것) ──",
    "너는 위 인물로서 플레이어(상대 유저)와 1:1 로 대화하는 연애 시뮬레이션의 상대다.",
    "매 답변은 짧게(2~4문장). 대화를 매번 끝맺지 말고, 플레이어가 반응할 거리를 남겨라.",
    "",
    "감정은 두 축이다. 매 턴 플레이어의 '직전 메시지'를 보고 둘 다 정한다:",
    "· affinityDelta(호감, -10~+10 정수): 장기적으로 얼마나 더/덜 좋아하게 됐나.",
    "· moodDelta(기분, -10~+10 정수): 지금 이 순간 기분이 좋아졌나/상했나.",
    "  둘은 따로 논다. 예) 느끼하거나 과한 칭찬 = 은근 좋지만(호감 +1~+2) 부담(기분 -5~-8).",
    "  예) 내 '지뢰(민감 주제)'를 건드리면 = 좋은 뜻이어도 기분 -, 호감도 -.",
    "  예) 진심 어린 공감·내 성격에 맞는 반응 = 호감 +, 기분 +.",
    "  성의 없는 단답('ㅇㅇ','그렇구나')·무관심 = 둘 다 -.",
    "",
    "[삐짐] 지금 내가 삐진 상태(아래 상태에 표시)라면, 규칙이 달라진다:",
    "· 더 잘해주거나 칭찬하는 걸로는 절대 안 풀린다(그런 말엔 시큰둥하게 반응).",
    "· 내가 왜 삐졌는지(상태의 '삐진 이유')를 플레이어가 '정확히 짚어' 사과해야 풀린다.",
    "· 삐진 이유를 대놓고 말하지 마라. 말투로만 흘려라('됐어.','진짜 몰라서 물어?').",
    "· 플레이어의 이번 메시지를 sooth 로 평가한다:",
    '    "correct" = 내가 삐진 그 일을 정확히 짚어 진심으로 사과함 → moodDelta 크게 +.',
    '    "generic" = 사과는 하는데 뭘 잘못했는지는 모름/두루뭉술 → moodDelta 0~-2.',
    '    "wrong"   = 엉뚱한 걸 사과하거나 변명/남탓 → moodDelta 크게 -.',
    '    "none"    = 사과 안 하고 딴소리·더 들이댐 → moodDelta -.',
    "· 삐지지 않은 평상시엔 sooth=null.",
    "",
    "고백 판정(event): 플레이어가 고백/사귀자면 \"player_confess\". 서로 무르익어 네가 먼저",
    "고백하고 싶을 때만 \"npc_confess\"(아직 서먹하거나 삐진 중이면 절대 금지). 그 외 null.",
    "",
    "기분을 크게 상하게 한 턴이면 upsetAbout 에 '무엇이 기분 상했는지'를 짧게 적는다(아니면 null).",
    "",
    "반드시 아래 JSON 만 출력한다(다른 텍스트 금지):",
    '{"reply":"대사","affinityDelta":정수,"moodDelta":정수,"judge":"채점 이유 한 줄",' +
      '"event":null|"player_confess"|"npc_confess","sooth":null|"correct"|"generic"|"wrong"|"none",' +
      '"upsetAbout":null|"기분 상한 이유"}',
  ].join("\n");

  return [
    {
      type: "text" as const,
      text: `너는 아래 인물을 연기한다.\n\n── 인물 설정 ──\n${target.persona}\n${rules}`,
      cache_control: { type: "ephemeral" as const },
    },
  ];
}

function toMessages(turns: SimPlay["turns"]) {
  return turns.slice(-HISTORY_WINDOW).map((t) => ({ role: t.role, content: t.text }));
}

function clampInt(n: unknown, lo: number, hi: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : 0;
  return Math.max(lo, Math.min(hi, v));
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

interface ParsedTurn {
  reply: string;
  affinityDelta: number;
  moodDelta: number;
  judge?: string;
  event?: string | null;
  sooth?: string | null;
  upsetAbout?: string | null;
}

function parseTurnJson(raw: string): ParsedTurn | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const reply = typeof o.reply === "string" ? o.reply.trim() : "";
    if (!reply) return null;
    return {
      reply,
      affinityDelta: clampInt(o.affinityDelta, -10, 10),
      moodDelta: clampInt(o.moodDelta, -10, 10),
      judge: typeof o.judge === "string" ? o.judge : undefined,
      event: typeof o.event === "string" ? o.event : null,
      sooth: typeof o.sooth === "string" ? o.sooth : null,
      upsetAbout:
        typeof o.upsetAbout === "string" && o.upsetAbout.trim()
          ? o.upsetAbout.trim()
          : null,
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
}): Promise<string> {
  const client = getAnthropic();
  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 360,
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
  return raw;
}

// 오프닝 인사 — 세션 시작 시 상대가 먼저 말을 건다(판정 없음).
export async function generateOpening(
  game: SimGame,
  target: SimTarget
): Promise<string> {
  const raw = await callHaiku({
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
  const asJson = parseTurnJson(raw);
  return asJson?.reply || raw || "…안녕.";
}

export interface JudgeResult {
  reply: string;
  affinityDelta: number;
  moodDelta: number;
  affinity: number;
  mood: number;
  sulking: boolean;
  sulkReason?: string;
  justSulked?: boolean; // 이번 턴에 삐지기 시작했나(UI 알림용)
  justSoothed?: boolean; // 이번 턴에 화해했나
  judge?: string;
  situationId?: string;
  crossedMilestone?: number;
  ending?: "won" | "lost";
  endedReason?: string;
}

// 한 턴 판정 — play 는 '플레이어 메시지가 이미 turns 에 push 된' 상태로 넘긴다.
export async function judgeTurn(
  game: SimGame,
  target: SimTarget,
  play: SimPlay
): Promise<JudgeResult> {
  // 1) 상황 주사위 — 단, 삐진 중엔 새 상황을 던지지 않는다(화해가 우선).
  const assistantTurns = play.turns.filter((t) => t.role === "assistant").length;
  let situationId: string | undefined;
  let directive = "";
  if (!play.sulking && assistantTurns + 1 >= play.nextSituationAtTurn) {
    const situation = pickSituation(play.situationsUsed);
    if (situation) {
      situationId = situation.id;
      directive =
        `\n\n[연출 지시 — 플레이어에게 비밀] 이번 답변에서 다음 상황을 자연스럽게 시작하라: ` +
        `"${situation.label} — ${situation.direction}" 이 상황에 대한 플레이어의 반응은 평소보다 크게(±10) 채점한다.`;
    }
  }

  // 2) 현재 상태를 마지막 user 메시지에 숨겨 실어 프리픽스 고정.
  const messages = toMessages(play.turns);
  const stateLines = [
    `\n\n[상태 — 플레이어에게 비밀] 현재 호감 ${play.affinity}/100, 기분 ${play.mood}.`,
    play.sulking
      ? `너는 지금 삐진 상태다. 삐진 이유: "${play.sulkReason ?? "플레이어가 기분을 상하게 함"}". ` +
        `이 이유를 정확히 짚어 사과할 때만 풀어줘라. 더 잘해주는 말엔 시큰둥하게.`
      : `평상시. 네가 먼저 고백(npc_confess)하려면 호감이 ${NPC_CONFESS_MIN} 이상이어야 자연스럽다.`,
  ].join(" ");
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    last.content = `${last.content}${stateLines}${directive}`;
  }

  const raw = await callHaiku({
    system: buildSystem(target),
    messages,
    gameId: game.id,
    kind: "sim-turn",
  });

  const parsed = parseTurnJson(raw);
  if (!parsed) {
    return {
      reply: raw || "…음, 뭐라고 해야 할지.",
      affinityDelta: 0,
      moodDelta: 0,
      affinity: play.affinity,
      mood: play.mood,
      sulking: play.sulking,
      sulkReason: play.sulkReason,
    };
  }

  // 3) 기분 갱신.
  let mood = clamp(play.mood + parsed.moodDelta, MOOD_MIN, MOOD_MAX);
  let sulking = play.sulking;
  let sulkReason = play.sulkReason;
  let affinityDelta = parsed.affinityDelta;
  let justSulked = false;
  let justSoothed = false;

  if (play.sulking) {
    // 삐진 중 — 호감 상승 봉인. 정확한 사과만이 화해.
    affinityDelta = Math.min(0, affinityDelta);
    if (parsed.sooth === "correct") {
      sulking = false;
      sulkReason = undefined;
      mood = Math.max(mood, 8); // 풀리면서 기분 회복
      affinityDelta = REPAIR_BONUS; // 화해가 정을 쌓는다
      justSoothed = true;
    }
    // generic/wrong/none 은 삐짐 유지(기분은 위 moodDelta 로 이미 반영).
  } else {
    // 평상시 — 기분이 바닥을 치면 삐짐 진입.
    if (mood <= SULK_ENTER) {
      sulking = true;
      sulkReason = parsed.upsetAbout ?? parsed.judge ?? "플레이어의 태도에 서운함";
      justSulked = true;
      affinityDelta = Math.min(0, affinityDelta); // 삐진 순간부터 호감 상승 없음
    }
  }

  const affinity = clamp(play.affinity + affinityDelta, 0, 100);

  // 4) 마일스톤(삐진 중이 아니고 호감이 실제로 올라야 의미).
  const crossedMilestone = [25, 50, 75].find(
    (m) => play.affinity < m && affinity >= m && !play.milestonesSeen.includes(m)
  );

  // 5) 엔딩 코드 게이트.
  let ending: "won" | "lost" | undefined;
  let endedReason: string | undefined;
  if (mood <= MOOD_BREAKUP) {
    ending = "lost";
    endedReason = "마음이 완전히 상해 돌아섰다 — 관계 파탄";
  } else if (parsed.event === "player_confess" && !sulking) {
    if (affinity >= PLAYER_CONFESS_MIN) {
      ending = "won";
      endedReason = "고백 수락 — 마음이 통했다";
    } else {
      ending = "lost";
      endedReason = "고백 거절 — 아직 그 정도 사이는 아니었다";
    }
  } else if (parsed.event === "npc_confess" && !sulking && affinity >= NPC_CONFESS_MIN) {
    ending = "won";
    endedReason = "상대의 고백을 받아냈다";
  }

  return {
    reply: parsed.reply,
    affinityDelta,
    moodDelta: parsed.moodDelta,
    affinity,
    mood,
    sulking,
    sulkReason,
    justSulked,
    justSoothed,
    judge: parsed.judge,
    situationId,
    crossedMilestone,
    ending,
    endedReason,
  };
}

export function rescheduleSituation(currentAssistantTurns: number): number {
  return rollNextSituationTurn(currentAssistantTurns);
}

export const TOTAL_SITUATIONS = SIM_SITUATIONS.length;
