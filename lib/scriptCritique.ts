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

// 리포트를 체크박스로 고를 수 있게 쪼갠 항목 하나. 글 뭉치를 읽고 손으로 옮기는 대신
// 항목마다 체크해서 반영한다(사용자 요청 2026-07-25).
export interface CritiqueFix {
  id: string;
  kind: "edit" | "insert"; // 씬 문장 교체 / 그 씬 뒤에 반전 씬 추가
  plan: "A" | "B"; // 리포트 2부의 A안(씬 수정)·B안(반전 씬 추가) 중 어디서 나왔는지
  scene: number; // 1-based 씬 번호. insert 면 "이 씬 뒤"에 넣는다.
  severity: "high" | "mid" | "low";
  issue: string; // 무엇이 문제인지 한 줄
  grade?: string; // 공식/보도/관찰/추측
  original: string; // 원문(교체 대상). insert 면 빈 문자열.
  revised: string; // 반영할 나레이션 전문
  sources?: string[]; // 근거 URL
  image?: "keep" | "regen"; // 기존 그림 그대로 / 재생성 필요
}

export interface CritiqueResult {
  report: string; // 2부 리포트(그대로 표시)
  fixes: CritiqueFix[]; // 체크박스로 고를 수 있게 구조화한 반영안
  verdict: string; // 한 줄 총평(각도 유지/전환/전면 재작성 권고)
  searched: boolean; // 실제로 웹 검색이 돌았는지
  costUsd: number;
}

// 리포트(자연어) → 반영 항목 배열. 검색이 도는 1차 호출에 JSON 까지 시키면 서버 도구
// 루프와 섞여 형식이 깨지므로, 도구 없는 2차 호출로 분리해 옮겨 적기만 시킨다.
const EXTRACT_INSTRUCTION = `위 검수 리포트를 그대로 옮겨 적어 JSON 으로만 답해라. 새로운 판단·새 제안을 만들지 말고, 리포트에 이미 있는 내용만 항목으로 쪼개라.

{"verdict":"각도 유지/전환 권고 한 줄","fixes":[{"kind":"edit"|"insert","plan":"A"|"B","scene":정수(1-based),"severity":"high"|"mid"|"low","issue":"문제 한 줄","grade":"공식|보도|관찰|추측","original":"원문 문장(insert 면 빈 문자열)","revised":"반영할 나레이션 전문","sources":["url"],"image":"keep"|"regen"}]}

규칙:
- A안(씬 수정)은 kind="edit", B안(반전 씬 추가)은 kind="insert" 로. 둘 다 있으면 둘 다 넣어라.
- revised 는 그 씬에 그대로 들어갈 나레이션 "전문"이어야 한다(문장 조각·설명문 금지).
- insert 의 scene 은 새 씬이 들어갈 "앞 씬"의 번호다.
- 리포트에 근거 URL 이 있으면 sources 에 담아라. 없으면 생략.
- JSON 외 다른 텍스트를 쓰지 마라.`;

function parseFixes(raw: string): { fixes: CritiqueFix[]; verdict: string } {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return { fixes: [], verdict: "" };
  let obj: { verdict?: unknown; fixes?: unknown };
  try {
    obj = JSON.parse(m[0]);
  } catch {
    return { fixes: [], verdict: "" };
  }
  const list = Array.isArray(obj.fixes) ? obj.fixes : [];
  const fixes: CritiqueFix[] = [];
  list.forEach((r, i) => {
    const f = r as Record<string, unknown>;
    const revised = String(f.revised ?? "").trim();
    const scene = Math.trunc(Number(f.scene));
    // 반영할 문장이 없거나 씬 번호가 없는 항목은 체크해도 할 일이 없다 — 버린다.
    if (!revised || !Number.isFinite(scene) || scene < 1) return;
    const sources = Array.isArray(f.sources)
      ? f.sources.map((s) => String(s)).filter((s) => /^https?:\/\//.test(s))
      : undefined;
    fixes.push({
      id: `${f.kind === "insert" ? "ins" : "ed"}-${scene}-${i}`,
      kind: f.kind === "insert" ? "insert" : "edit",
      plan: f.plan === "B" ? "B" : "A",
      scene,
      severity: f.severity === "high" || f.severity === "low" ? f.severity : "mid",
      issue: String(f.issue ?? "").trim(),
      grade: f.grade ? String(f.grade).trim() : undefined,
      original: f.kind === "insert" ? "" : String(f.original ?? "").trim(),
      revised,
      sources: sources?.length ? sources : undefined,
      image: f.image === "regen" ? "regen" : f.image === "keep" ? "keep" : undefined,
    });
  });
  return { fixes, verdict: String(obj.verdict ?? "").trim() };
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

  // 2차 호출 — 리포트를 체크박스 항목으로 쪼갠다(도구 없음, 짧고 저렴). 여기서 실패해도
  // 리포트 자체는 살아 있어야 하므로 조용히 빈 배열로 떨어뜨린다.
  let fixes: CritiqueFix[] = [];
  let verdict = "";
  if (last) {
    try {
      const ex = (await client.messages.create({
        model: MODELS.sonnet,
        max_tokens: 8000,
        system: "너는 검수 리포트를 구조화된 JSON 으로 옮겨 적는 변환기다. JSON 만 출력한다.",
        messages: [
          { role: "user", content: `[검수 리포트]\n${report}\n\n${EXTRACT_INSTRUCTION}` },
        ] as never,
      })) as unknown as Msg;
      totalCost += anthropicCostUsd({
        inputTokens: ex.usage.input_tokens,
        outputTokens: ex.usage.output_tokens,
        model: MODELS.sonnet,
      });
      const parsed = parseFixes(
        ex.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("")
      );
      fixes = parsed.fixes;
      verdict = parsed.verdict;
    } catch {
      /* 구조화 실패 — 리포트만으로도 쓸 수 있다 */
    }
  }

  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd: 0,
    meta: { kind: "script-critique-extract", fixes: fixes.length },
  }).catch(() => {});

  return { report, fixes, verdict, searched, costUsd: totalCost };
}
