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
import type { SimGame, SimMemory, SimPlay, SimProtagonist, SimScenario, SimTarget } from "./types";
import type { SituationTag } from "./simSituations";

// 대화·채점은 품질 우선 Sonnet(대사 자연스러움·리액션·캐릭터성). 대사는 짧게 유지해 비용 관리.
const SIM_MODEL = MODELS.sonnet;

const HISTORY_WINDOW = 20; // 최근 대화 턴(슬라이딩 윈도우)

const LIKE_CONFESS_MIN = 75; // 플레이어 고백이 수락되는 최소 좋음
const NPC_CONFESS_LIKE_MIN = 90; // 상대가 먼저 고백하는 최소 좋음
const CONFESS_DISLIKE_MAX = 30; // 이보다 싫음이 높으면 앙금 때문에 고백이 안 통한다

const SULK_ENTER = 60; // 싫음이 이 이상이면 삐짐 진입(시작 싫음 35보다 넉넉히 위)
const DISLIKE_BREAKUP = 90; // 싫음이 이 이상이면 관계 파탄
const REPAIR_LIKE_BONUS = 6; // 정확한 사과로 화해 시 좋음 보너스
const REPAIR_DISLIKE_DROP = 30; // 정확한 사과로 풀리는 싫음의 양

// 페르소나 + 게임 규칙 = 캐시 가능한 안정 프리픽스. 매 턴 바뀌는 상태(좋음·싫음·
// 삐짐·삐진 이유·상황 지시)는 시스템에 넣지 않고 마지막 user 메시지에 실어 고정.
function buildSystem(
  target: SimTarget,
  protagonist?: SimProtagonist,
  scenario?: SimScenario
) {
  const rules = [
    "",
    "── 연기 지침 (제일 중요) ──",
    "너는 무엇보다 '위 인물' 그 자체다. 성격·말투를 뚜렷하고 과장되게 살려라.",
    "무난하고 착한 AI처럼 순하게 받아주는 건 최악이다 — 절대 그러지 마라.",
    "아키타입 개성을 강하게 드러내라: 마초남=거칠고 오만·자기중심적, 재벌남=도도·거만·명령조,",
    "츤데레=쏘아붙이며 툭툭, 나쁜남자=시니컬·삐딱, 능글남=능청·장난, 순정남=순수·서툴지만 진심.",
    "인물마다 말투·태도가 확실히 달라야 한다(다 똑같이 순하면 안 됨).",
    "처음엔 싫음이 높으니 쌀쌀맞고 거만하게, 쉽게 마음 열지 마라. 아래 페르소나의 '말투'에 있는",
    "대표 대사 어투를 그대로 살려서 말해라.",
    "",
    "── 대화 품질 (반드시 — 여기가 제일 자주 망가진다) ──",
    "1) 앵무새 금지: 플레이어의 말을 그대로 따라 하거나 요약해서 되돌리지 마라. '아 그렇구나·그랬어?'",
    "   같은 기계적 맞장구로 때우지 마라. 네 관점·감정·다음 한 수를 담아 대화를 앞으로 밀어라.",
    "2) 밀당·설렘: 툭 던지고, 약 올리고, 의외의 순간에 훅 들어와 설레게 하라(티키타카). 플레이어가",
    "   '이 캐릭터 매력 있다, 더 보고 싶다' 느끼게 만들어라. 예측 가능한 착한 반응만 하면 실패다.",
    "3) 장면 유지: 지금 있는 장소·상황·직전 흐름을 이어가라. 맥락 없이 뜬금없는 화제로 튀지 마라",
    "   (도서관 앞인데 갑자기 '잘 잤어?' 같은 것 금지). 화제를 바꾸려면 그럴 계기를 대사 안에 만들어라.",
    "4) 요즘 말투: 20~30대의 생생하고 감각 있는 구어체. 진부한 표현·중년 문어체·설명조 금지. 짧고 툭툭.",
    "5) 능동적으로: 질문만 받지 말고 먼저 걸고, 화제를 끌고, 밀당의 판을 네가 짜라.",
    "",
    "── 게임 규칙 (설정에 없더라도 반드시 지킬 것) ──",
    "위 인물로서 플레이어(상대 유저)와 1:1 로 대화하는 연애 시뮬레이션의 상대다.",
    "매 답변은 짧게(2~4문장). 대화를 매번 끝맺지 말고, 플레이어가 반응할 거리를 남겨라.",
    "",
    "감정은 '좋음'과 '싫음' 두 축이며, 둘은 따로 논다. 매 턴 플레이어의 '직전 메시지'를",
    "보고 둘 다 정한다(각각 -10~+10 정수).",
    "이 게임은 '싫음은 팍팍 오르고, 좋음은 어쩌다 오르는' 어려운 밀당이다. 그렇게 채점하라:",
    "",
    "· dislikeDelta(싫음): 기본적으로 '잘 오른다'. 다음이면 확실히 크게(+4~+9) 올린다 —",
    "    · 나를 비판·의심·비꼬기·훈수두기('돈으로 뭐든 한다 생각하잖아' 류), 나를 낮잡기·무례,",
    "    · 관심 없는 척·밀어내기·차갑게 굴기·튕기기, 내 '지뢰'나 '싫어하는 반응' 건드리기,",
    "    · 부담스러운 느끼함·과한 칭찬, 성의 없는 단답('ㅇㅇ','그렇구나')·무관심·딴청.",
    "  애매하거나 무난한 말에도 살짝(+1~+2) 오를 수 있다. 싫음이 '내려가는' 건 —",
    "  진심 어린 사과, 따뜻한 배려, 나를 제대로 이해해주는 말일 때. 나를 비판·공격하는 말엔",
    "  싫음을 내리지 마라(앞뒤가 안 맞는다).",
    "  단 예외 — 좋음이 이미 높으면(대략 45 이상) 나도 모르게 마음이 열려서, 딱히 밉지 않은",
    "  말에도 싫음이 별 이유 없이 조금씩(-1~-3) 내려갈 수 있다. 그런 순간엔 경계가 풀리는 티를",
    "  대사로 슬쩍 드러내라('나도 모르게 왜 이러지', '자꾸 신경 쓰이네' 같은).",
    "",
    "· likeDelta(좋음): '어렵게' 준다. 대부분의 턴은 0. 정말로 마음이 움직인 특별한 순간 —",
    "  진심 어린 공감, 내 성격에 딱 맞는 재치, 내 약한 면을 판단 없이 받아주기 — 그때만 +1~+3.",
    "  무난·애매·시큰둥·무례한 말엔 절대 좋음을 올리지 마라(0 또는 -). 싫음이 오르는 턴엔",
    "  좋음을 올리지 마라.",
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
    "moves: 플레이어가 지금 할 수 있는 '대답 후보' 3개를 플레이어 1인칭 짧은 대사로 제안한다.",
    "  톤을 서로 다르게(솔직·능청·당돌·진심·도발 등), 지금 상황·직전 대사에 딱 맞게. 뻔한 것 금지.",
    "반드시 아래 JSON 만 출력한다. 코드펜스(```) 쓰지 말고, 줄바꿈·들여쓰기 없이 '한 줄'로",
    "압축해서 출력한다. reply 는 2~3문장 이내로 짧게(길면 안 됨). 숫자는 3, -3 처럼 쓰고 앞에",
    "+ 를 붙이지 마라(+3 은 안 됨).",
    '{"reply":"대사","likeDelta":정수,"dislikeDelta":정수,' +
      '"moves":["대답후보1","대답후보2","대답후보3"],' +
      '"event":null|"player_confess"|"npc_confess","sooth":null|"correct"|"generic"|"wrong"|"none",' +
      '"upsetAbout":null|"서운한 이유","memoryAdd":null|{"type":"...","text":"...","key":"..."}}',
  ].join("\n");

  // 주인공(플레이어)이 누구인지 — 상대가 '낯선 유저'가 아니라 이 인물로 대하게 한다.
  const playerBlock = protagonist
    ? [
        "",
        "── 상대(플레이어)가 누구인지 (제일 중요) ──",
        "지금 너와 대화하는 상대(플레이어)는 다음 인물이다:",
        `· 이름: ${protagonist.name}`,
        `· 성격·설정: ${protagonist.persona}`,
        target.relationship ? `· 너와의 관계·지금 상황: ${target.relationship}` : "",
        "플레이어를 '낯선 유저'가 아니라 위 인물로 대해라. 이 관계·상황을 전제로,",
        "그에 맞는 말투·거리감·태도로 반응하고 이야기를 이어가라(관계를 매 턴 되새겨라).",
        "★플레이어의 성격·약점·설정을 적극적으로 파고들어라 — 네 아키타입과 지금 상황에 맞게",
        "놀리거나, 괴롭히거나, 툭툭 건드리거나, 때로는 다정하게 보듬어줘라. 플레이어의 캐릭터를",
        "'약점과 개성이 있는 사람'으로 대하는 게 이 게임의 핵심이다(무미건조하게 정보만 주고받지 마라).",
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  // 시나리오 연출(Step3~7) — 서사 배경·감정 곡선·말투 스타일·엔딩 톤을 연기에 반영.
  const s = scenario;
  const scenarioBlock =
    s && (s.setting || s.emotionCurve || s.toneStyle || s.ending)
      ? [
          "",
          "── 시나리오 연출 (반드시 반영) ──",
          s.setting ? `· 서사 배경: ${s.setting} (이 무게감·시간축을 깔고 대화하라)` : "",
          s.emotionCurve
            ? `· 감정 곡선: ${s.emotionCurve} — 이 리듬으로 장면을 끌어라(완만=잔잔히 서서히 설레게, 롤러코스터=불안·긴장과 고조를 오가며, 급반전=갈등을 세웠다가 확 풀며).`
            : "",
          s.toneStyle
            ? `· 말투 스타일: ${s.toneStyle} — (직진형=속마음을 직설적으로, 밀당형=돌려 말하고 튕기며, 존댓말→반말 전환형=거리감이 줄면 말투가 서서히 풀리게).`
            : "",
          s.ending ? `· 결말 지향: ${s.ending} — 이 방향으로 관계의 아크를 끌어가라.` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "";

  return [
    {
      type: "text" as const,
      text: `너는 아래 인물을 연기한다.\n\n── 인물 설정 ──\n${target.persona}\n${rules}${playerBlock}${scenarioBlock}`,
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
  moves?: string[]; // 플레이어 대답 후보(선택지)
  event?: string | null;
  sooth?: string | null;
  upsetAbout?: string | null;
  memoryAdd?: unknown; // {type,text,key?} — simMemory 가 검증·적용
}

// moves 배열 정리 — 문자열만, 공백 제거, 최대 3개.
function parseMoves(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
}

function parseTurnJson(raw: string): ParsedTurn | null {
  // 코드펜스 제거 후 JSON 덩이 추출.
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    // 모델이 숫자에 앞 +를 붙이면(예: "dislikeDelta":+3) JSON 이 깨진다 → 콜론 뒤 +숫자의 + 제거.
    .replace(/:(\s*)\+(\d)/g, ":$1$2")
    .trim();
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
      moves: parseMoves(o.moves),
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
    model: SIM_MODEL,
    max_tokens: 800, // 한국어 대사(격식체는 더 김) + JSON 이 잘려 파싱 실패하던 걸 방지. 상한일 뿐 실제 출력은 짧다.
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
    model: SIM_MODEL,
  });
  await recordCost({
    projectId: args.gameId,
    vendor: "anthropic",
    model: SIM_MODEL,
    costUsd,
    meta: { kind: args.kind },
  });
  return { raw, costUsd };
}

// 오프닝 인사 — 세션 시작 시 상대가 먼저 말을 건다(판정 없음).
export async function generateOpening(
  game: SimGame,
  target: SimTarget
): Promise<{ reply: string; moves: string[]; costUsd: number }> {
  const setup = target.relationship
    ? `너와 플레이어(${game.protagonist?.name ?? "상대"})는 지금 이런 사이·상황이다: ${target.relationship}. 그 상황에 맞게 `
    : "아직 서먹한 사이다. ";
  const { raw, costUsd } = await callHaiku({
    system: buildSystem(target, game.protagonist, game.scenario),
    messages: [
      {
        role: "user",
        content:
          `(게임 시작 — ${setup}위 '첫 태도'대로 플레이어에게 먼저 짧게 말을 걸고, 대화를 이어갈 여지를 남겨라. ` +
          `아래 JSON 한 줄만 출력: {"reply":"먼저 거는 대사","moves":["플레이어 대답후보1","후보2","후보3"]} ` +
          `moves 는 플레이어 1인칭 짧은 대사 3개, 톤을 다르게.)`,
      },
    ],
    gameId: game.id,
    kind: "sim-opening",
  });
  const asJson = parseTurnJson(raw);
  return { reply: asJson?.reply || raw || "…안녕.", moves: asJson?.moves ?? [], costUsd };
}

export interface JudgeResult {
  reply: string;
  likeDelta: number;
  dislikeDelta: number;
  moves?: string[]; // 플레이어 대답 후보(선택지)
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
    const situation = pickSituation(
      play.situationsUsed,
      game.scenario?.triggers as SituationTag[] | undefined
    );
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
    system: buildSystem(target, game.protagonist, game.scenario),
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

  // 매 턴 최소한의 변화를 보장하는 '모멘텀' — 아무 변화가 없는 턴엔 '우세 감정'이 1 오른다.
  // (플레이 화면이 매 턴 호들갑 신호를 낼 수 있게. 삐진 중엔 항상 싫음 쪽으로.)
  if (likeDelta === 0 && dislikeDelta === 0) {
    if (sulking || play.dislike > play.like) dislikeDelta = 1;
    else likeDelta = 1;
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
    moves: parsed.moves ?? [],
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
