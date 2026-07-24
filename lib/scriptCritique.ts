// ============================================================================
// [2단계 대본] 비판 검수 — 웹 검색으로 반대편 사실을 찾아 2부 리포트를 낸다.
// ----------------------------------------------------------------------------
// 홍보 자료 같은 일방적 대본이 그대로 나가는 것을 막는 게 목적. 대본 문면만 보지 않고
// 반드시 서버사이드 웹 검색 도구(web_search)로 확인한다. 자동 반영은 하지 않는다 —
// 리포트만 돌려주고, 반영은 사용자가 동의(A/B·씬 지정)한 뒤 별도 대화로 처리한다.
// 서버 도구 루프가 max 반복에 걸리면 pause_turn 으로 멈추므로, 재전송으로 이어 돌린다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { CRITIQUE_PROMPT } from "./scriptButtons";

// @anthropic-ai/sdk 의 세부 타입은 버전에 따라 흔들려서, 필요한 필드만 최소로 좁혀 쓴다.
type Block = { type: string; text?: string };
type Msg = {
  content: Block[];
  stop_reason?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};
type MsgParam = { role: "user" | "assistant"; content: unknown };

// 최신 모델(Opus 4.8)은 web_search_20260209(동적 필터링). 별도 베타 헤더 불필요.
// 검증 항목이 대본 하나에 여러 개다(현재형 주장·숫자·반대편 사실 축 5개+). 5회로는
// 한도가 먼저 소진돼 "검증 보류"만 나온다 — 실측 후 20회로 상향(2026-07-25).
const WEB_SEARCH_TOOL = { type: "web_search_20260209", name: "web_search", max_uses: 20 };

export interface CritiqueResult {
  report: string; // 2부 리포트(그대로 표시)
  searched: boolean; // 실제로 웹 검색이 돌았는지
  costUsd: number;
}

function scriptToNumbered(narrations: string[]): string {
  return narrations.map((n, i) => `${i + 1}. ${(n ?? "").trim()}`).join("\n");
}

export async function critiqueScript(args: {
  projectId: string;
  narrations: string[];
  imagesReady?: boolean; // 그림(씬 이미지) 완성 여부 — 6번 그림 호환 판정에 쓴다
}): Promise<CritiqueResult> {
  const { projectId, narrations, imagesReady } = args;
  const client = getAnthropic();

  const system =
    "너는 경제·투자 유튜브 채널의 대본 검수자다. 홍보성·일방적 대본이 그대로 나가지 않게 " +
    "반대편 사실을 웹 검색으로 찾아 비판적으로 검수한다. 회사 고유명사·숫자·현재형 주장은 " +
    "반드시 web_search 로 최신 정보를 확인하고, 대본 문면만 보고 판정하지 마라. 한국어로 답한다.";

  const user =
    `${CRITIQUE_PROMPT}\n\n` +
    (imagesReady ? "(그림 완성 상태: 예 — 6번 그림 호환 판정을 포함해라)\n\n" : "") +
    `[대본 — 씬 번호. 나레이션]\n${scriptToNumbered(narrations)}`;

  const messages: MsgParam[] = [{ role: "user", content: user }];
  let totalCost = 0;
  let searched = false;
  const MAX_ROUNDS = 6; // pause_turn 이어 돌리기 상한(무한 루프 방지)

  let last: Msg | null = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 웹 검색이 여러 번 도는 서버 도구 응답은 5분+ 걸린다 → 비스트리밍 요청은 타임아웃.
    // 스트리밍으로 받아 연결을 살려 둔다(이벤트마다 read 타임아웃 리셋). finalMessage 로 취합.
    const stream = client.messages.stream(
      {
        model: MODELS.opus,
        max_tokens: 8000,
        system,
        tools: [WEB_SEARCH_TOOL] as never,
        messages: messages as never,
      },
      { maxRetries: 0 }
    );
    const r = (await stream.finalMessage()) as unknown as Msg;

    totalCost += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.opus,
    });
    if (r.content.some((b) => b.type === "web_search_tool_result" || b.type === "server_tool_use")) {
      searched = true;
    }
    last = r;
    // 서버 도구 루프가 반복 상한에 걸렸으면(pause_turn) 응답을 그대로 이어붙여 재전송.
    if (r.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: r.content });
      continue;
    }
    break;
  }

  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.opus,
    costUsd: totalCost,
    meta: { kind: "script-critique" },
  }).catch(() => {});

  const report =
    (last?.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("")
      .trim() || "검수 결과를 받지 못했어요 — 다시 시도해주세요.";

  return { report, searched, costUsd: totalCost };
}
