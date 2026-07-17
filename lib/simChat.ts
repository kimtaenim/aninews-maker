// ============================================================================
// 시뮬 대화 판정 코어 — 좋음 + 싫음 2축 감정 모델.
// ----------------------------------------------------------------------------
// 두 개의 독립 누적치로 실제 연애 동역학을 반영한다:
//  · 좋음(0~100): 쌓인 호감. 승리 지표.
//  · 싫음(0~100): 쌓인 거부감·서운함. 삐짐·파탄 지표.
//  · 한 말이 좋음·싫음을 '동시에' 올릴 수 있다(느끼한 말: 은근 좋지만 부담스럽다).
//  · 지뢰(민감 주제)를 밟으면 좋은 말이라도 싫음이 오른다.
//  · 싫음이 임계치를 넘으면 '삐짐' — 이땐 좋음이 안 오른다. 더 잘해주는 걸로는
//    못 푼다(좋음만 오르고 싫음은 그대로). 삐진 '이유를 정확히 짚어' 사과해야
//    싫음이 내려가고 풀린다. 두루뭉술 사과는 그대로, 엉뚱한 사과는 싫음이 더 오른다.
//    잘 화해하면 좋음이 오른다(싸우고 화해하면 정든다).
//  · 방치해 싫음이 최대에 이르면 관계 파탄(패배).
//  · 승리는 좋음이 충분(≥75)하고 싫음이 낮을(≤30) 때만 — 앙금이 쌓여 있으면
//    아무리 좋아해도 고백을 안 받아준다.
// 승패·상태 전이는 코드가 최종 판정. Claude 는 채점값과 대사를 낼 뿐이다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { pickSituation, rollNextSituationTurn, SIM_SITUATIONS } from "./simSituations";
import { applyMemoryAdd, formatMemory, memoryInstruction } from "./simMemory";
import type { SimGame, SimMemory, SimPlay, SimTarget } from "./types";

const HISTORY_WINDOW = 20; // 최근 대화 턴(슬라이딩 윈도우)

const LIKE_CONFESS_MIN = 75; // 플레이어 고백이 수락되는 최소 좋음
const NPC_CONFESS_LIKE_MIN = 90; // 상대가 먼저 고백하는 최소 좋음
const CONFESS_DISLIKE_MAX = 30; // 이보다 싫음이 높으면 앙금 때문에 고백이 안 통한다

const SULK_ENTER = 40; // 싫음이 이 이상이면 삐짐 진입
const DISLIKE_BREAKUP = 90; // 싫음이 이 이상이면 관계 파탄
const REPAIR_LIKE_BONUS = 6; // 정확한 사과로 화해 시 좋음 보너스
const REPAIR_DISLIKE_DROP = 30; // 정확한 사과로 풀리는 싫음의 양

// 페르소나 + 게임 규칙 = 캐시 가능한 안정 프리픽스. 매 턴 바뀌는 상태(좋음·싫음·
// 삐짐·삐진 이유·상황 지시)는 시스템에 넣지 않고 마지막 user 메시지에 실어 고정.
function buildSystem(target: SimTarget) {
  const rules = [
    "",
    "── 게임 규칙 (설정에 없더라도 반드시 지킬 것) ──",
    "너는 위 인물로서 플레이어(상대 유저)와 1:1 로 대화하는 연애 시뮬레이션의 상대다.",
    "매 답변은 짧게(2~4문장). 대화를 매번 끝맺지 말고, 플레이어가 반응할 거리를 남겨라.",
    "",
    "감정은 '좋음'과 '싫음' 두 축이며, 둘은 따로 논다. 매 턴 플레이어의 '직전 메시지'를",
    "보고 둘 다 정한다(각각 -10~+10 정수):",
    "· likeDelta(좋음): 얼마나 더/덜 좋아하게 됐나. 진심 어린 공감·내 성격에 맞는 반응이면 +.",
    "· dislikeDelta(싫음): 얼마나 거부감·서운함이 쌓였나/풀렸나. 부담·무례·지뢰면 +, 진심 어린",
    "  사과나 배려로 앙금이 풀리면 -.",
    "  중요: 한 말이 둘 다 올릴 수 있다. 예) 느끼하거나 과한 칭찬 = 은근 좋지만(like +1~+2)",
    "  부담스럽다(dislike +4~+7). 예) 내 '지뢰(민감 주제)'를 건드리면 = 좋은 뜻이어도 like 0/-,",
    "  dislike 크게 +. 성의 없는 단답('ㅇㅇ','그렇구나')·무관심 = like -, dislike +.",
    "",
    "[삐짐] 지금 내가 삐진 상태(아래 상태에 표시)라면, 규칙이 달라진다:",
    "· 더 잘해주거나 칭찬하는 걸로는 안 풀린다(그런 말엔 시큰둥하게, dislike 안 내려감).",
    "· 내가 왜 삐졌는지(상태의 '삐진 이유')를 플레이어가 '정확히 짚어' 사과해야 풀린다.",
    "· 삐진 이유를 대놓고 말하지 마라. 말투로만 흘려라('됐어.','진짜 몰라서 물어?').",
    "· 화가 난 상태에서 플레이어가 무례하게 굴면, 아래 '상대가 기억하는 것'의 아픈 곳을",
    "  콕 찔러 되받아쳐도 된다(연인 싸움의 리얼함). 단, 화해하면 그러지 마라.",
    "· 플레이어의 이번 메시지를 sooth 로 평가한다:",
    '    "correct" = 내가 삐진 그 일을 정확히 짚어 진심으로 사과함 → dislikeDelta 크게 -.',
    '    "generic" = 사과는 하는데 뭘 잘못했는지는 모름/두루뭉술 → dislikeDelta 0.',
    '    "wrong"   = 엉뚱한 걸 사과하거나 변명/남탓 → dislikeDelta +.',
    '    "none"    = 사과 안 하고 딴소리·더 들이댐 → dislikeDelta +.',
    "· 삐지지 않은 평상시엔 sooth=null.",
    "",
    "고백 판정(event): 플레이어가 고백/사귀자면 \"player_confess\". 서로 무르익어 네가 먼저",
    "고백하고 싶을 때만 \"npc_confess\"(아직 서먹하거나 삐진 중이면 절대 금지). 그 외 null.",
    "",
    "싫음을 크게 올린 턴이면 upsetAbout 에 '무엇이 서운/불쾌했는지'를 짧게 적는다(아니면 null).",
    "",
    memoryInstruction(),
    "",
    "반드시 아래 JSON 만 출력한다. 코드펜스(```) 쓰지 말고, 줄바꿈·들여쓰기 없이 '한 줄'로",
    "압축해서 출력한다. reply 는 2~3문장 이내로 짧게(길면 안 됨).",
    '{"reply":"대사","likeDelta":정수,"dislikeDelta":정수,' +
      '"event":null|"player_confess"|"npc_confess","sooth":null|"correct"|"generic"|"wrong"|"none",' +
      '"upsetAbout":null|"서운한 이유","memoryAdd":null|{"type":"...","text":"...","key":"..."}}',
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
  likeDelta: number;
  dislikeDelta: number;
  event?: string | null;
  sooth?: string | null;
  upsetAbout?: string | null;
  memoryAdd?: unknown; // {type,text,key?} — simMemory 가 검증·적용
}

function parseTurnJson(raw: string): ParsedTurn | null {
  // 코드펜스 제거 후 JSON 덩이 추출.
  const cleaned = raw.replace(/```(?:json)?/gi, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) {
    // JSON 이 잘려 닫는 괄호가 없을 때라도 대사는 살려 대화를 잇는다(델타는 0).
    const salvage = cleaned.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (salvage) {
      try {
        const reply = JSON.parse(`"${salvage[1]}"`) as string;
        if (reply.trim())
          return { reply: reply.trim(), likeDelta: 0, dislikeDelta: 0, event: null, sooth: null };
      } catch {
        /* 살리기 실패 — 아래로 */
      }
    }
    return null;
  }
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    const reply = typeof o.reply === "string" ? o.reply.trim() : "";
    if (!reply) return null;
    return {
      reply,
      likeDelta: clampInt(o.likeDelta, -10, 10),
      dislikeDelta: clampInt(o.dislikeDelta, -10, 10),
      event: typeof o.event === "string" ? o.event : null,
      sooth: typeof o.sooth === "string" ? o.sooth : null,
      upsetAbout:
        typeof o.upsetAbout === "string" && o.upsetAbout.trim()
          ? o.upsetAbout.trim()
          : null,
      memoryAdd: o.memoryAdd ?? null,
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
}): Promise<{ raw: string; costUsd: number }> {
  const client = getAnthropic();
  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 500, // 한국어 대사 + JSON 이 360 에서 가끔 잘려 파싱 실패 → 여유 확보
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
  return { raw, costUsd };
}

// 오프닝 인사 — 세션 시작 시 상대가 먼저 말을 건다(판정 없음).
export async function generateOpening(
  game: SimGame,
  target: SimTarget
): Promise<{ reply: string; costUsd: number }> {
  const { raw, costUsd } = await callHaiku({
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
  return { reply: asJson?.reply || raw || "…안녕.", costUsd };
}

export interface JudgeResult {
  reply: string;
  likeDelta: number;
  dislikeDelta: number;
  like: number;
  dislike: number;
  sulking: boolean;
  sulkReason?: string;
  memory: SimMemory[]; // 이번 턴 memoryAdd 적용 후 갱신된 기억
  costUsd: number; // 이 턴 Claude 비용(개발자 비용 푸터용)
  justSulked?: boolean; // 이번 턴에 삐지기 시작했나(UI 알림용)
  justSoothed?: boolean; // 이번 턴에 화해했나
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

  // 2) 현재 상태 + 관계 기억을 마지막 user 메시지에 숨겨 실어 프리픽스 고정.
  const messages = toMessages(play.turns);
  const stateLines = [
    `\n\n[상태 — 플레이어에게 비밀] 현재 좋음 ${play.like}/100, 싫음 ${play.dislike}/100.`,
    play.sulking
      ? `너는 지금 삐진 상태다. 삐진 이유: "${play.sulkReason ?? "플레이어가 서운하게 함"}". ` +
        `이 이유를 정확히 짚어 사과할 때만 풀어줘라(dislikeDelta 크게 -). 더 잘해주는 말엔 시큰둥하게.`
      : `평상시. 네가 먼저 고백(npc_confess)하려면 좋음이 ${NPC_CONFESS_LIKE_MIN} 이상, 싫음이 ${CONFESS_DISLIKE_MAX} 이하로 무르익어야 자연스럽다.`,
  ].join(" ");
  const memoryBlock = formatMemory(play.memory);
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    last.content = `${last.content}${stateLines}${memoryBlock}${directive}`;
  }

  const { raw, costUsd } = await callHaiku({
    system: buildSystem(target),
    messages,
    gameId: game.id,
    kind: "sim-turn",
  });

  const parsed = parseTurnJson(raw);
  if (!parsed) {
    return {
      reply: raw || "…음, 뭐라고 해야 할지.",
      likeDelta: 0,
      dislikeDelta: 0,
      like: play.like,
      dislike: play.dislike,
      sulking: play.sulking,
      sulkReason: play.sulkReason,
      memory: play.memory,
      costUsd,
    };
  }

  // memoryAdd 적용 — 이번 턴 번호는 assistant 턴 수 기준.
  const memory = applyMemoryAdd(play.memory, parsed.memoryAdd, assistantTurns + 1);

  // 3) 싫음·좋음 갱신.
  let likeDelta = parsed.likeDelta;
  let dislikeDelta = parsed.dislikeDelta;
  let sulking = play.sulking;
  let sulkReason = play.sulkReason;
  let justSulked = false;
  let justSoothed = false;

  if (play.sulking) {
    // 삐진 중 — 좋음 상승 봉인. 정확한 사과만이 화해.
    likeDelta = Math.min(0, likeDelta);
    if (parsed.sooth === "correct") {
      sulking = false;
      sulkReason = undefined;
      // 앙금이 크게 풀리고, 화해가 정을 쌓는다.
      dislikeDelta = Math.min(dislikeDelta, -REPAIR_DISLIKE_DROP);
      likeDelta = REPAIR_LIKE_BONUS;
      justSoothed = true;
    } else {
      // generic/wrong/none — 삐짐 유지. 싫음은 위 dislikeDelta 로만 움직인다.
      dislikeDelta = Math.max(0, dislikeDelta); // 사과 안 통했으니 앙금이 줄지는 않는다
    }
  }

  const like = clamp(play.like + likeDelta, 0, 100);
  const dislike = clamp(play.dislike + dislikeDelta, 0, 100);

  // 평상시 싫음이 임계치를 넘으면 삐짐 진입.
  if (!play.sulking && dislike >= SULK_ENTER) {
    sulking = true;
    sulkReason = parsed.upsetAbout ?? "플레이어의 태도에 서운함";
    justSulked = true;
  }

  // 4) 마일스톤 — 좋음이 실제로 올라야 의미.
  const crossedMilestone = [25, 50, 75].find(
    (m) => play.like < m && like >= m && !play.milestonesSeen.includes(m)
  );

  // 5) 엔딩 코드 게이트.
  let ending: "won" | "lost" | undefined;
  let endedReason: string | undefined;
  if (dislike >= DISLIKE_BREAKUP) {
    ending = "lost";
    endedReason = "서운함이 쌓일 대로 쌓여 돌아섰다 — 관계 파탄";
  } else if (parsed.event === "player_confess" && !sulking) {
    if (like >= LIKE_CONFESS_MIN && dislike <= CONFESS_DISLIKE_MAX) {
      ending = "won";
      endedReason = "고백 수락 — 마음이 통했다";
    } else if (like >= LIKE_CONFESS_MIN) {
      ending = "lost";
      endedReason = "고백 거절 — 좋긴 한데 서운했던 게 걸린다";
    } else {
      ending = "lost";
      endedReason = "고백 거절 — 아직 그 정도 사이는 아니었다";
    }
  } else if (
    parsed.event === "npc_confess" &&
    !sulking &&
    like >= NPC_CONFESS_LIKE_MIN &&
    dislike <= CONFESS_DISLIKE_MAX
  ) {
    ending = "won";
    endedReason = "상대의 고백을 받아냈다";
  }

  return {
    reply: parsed.reply,
    likeDelta,
    dislikeDelta,
    like,
    dislike,
    sulking,
    sulkReason,
    memory,
    costUsd,
    justSulked,
    justSoothed,
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
