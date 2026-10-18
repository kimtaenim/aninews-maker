// ============================================================================
// 카드뉴스 입력 — PNG/JPG 카드 묶음 → 글자 읽기 → 괄호 출처 → 웹 검색 확인
// ----------------------------------------------------------------------------
// 1) readCardnews       — 카드 이미지들을 한 번의 vision 호출로 순서대로 읽고,
//                         괄호 안 출처 표기를 뽑아낸다(프로젝트는 만들지 않음).
// 2) researchCardnews   — 그 출처를 web_search 로 찾아 관련 사실을 확인한다.
// 화면에서 ①의 결과와 출처를 확인·수정한 뒤 ②를 돌리고, 그 다음에 프로젝트를
// 만든다(확인 게이트). 대본은 기존 대본 단계가 만든다 — 여기서 만들지 않는다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { CARDNEWS_READ_SYSTEM, CARDNEWS_RESEARCH_SYSTEM } from "./cardnewsPrompt";

export const CARDNEWS_MAX_IMAGES = 12;

// 카드 하단의 작은 괄호 출처를 놓치면 이 기능 전체가 무의미하다 — 읽기는 sonnet.
const READ_MODEL = MODELS.sonnet;
// web_search 서버 도구를 쓰므로 haiku 는 불가(400 invalid_request).
const RESEARCH_MODEL = MODELS.sonnet;
// 검색 결과가 토큰으로 들어와 매 턴 재전송된다 — 횟수가 곧 비용이다(확장판 실측 기준).
const SEARCH_MAX_USES = 5;
const MAX_ROUNDS = 2;

export interface CardnewsCard {
  index: number;
  text: string;
}

export interface CardnewsReadResult {
  cards: CardnewsCard[];
  title: string;
  body: string;
  attributions: string[];
  costUsd: number;
}

export interface CardnewsLink {
  title: string;
  url: string;
}

export interface CardnewsResearchResult {
  report: string;
  links: CardnewsLink[];
  searched: boolean;
  costUsd: number;
}

export interface CardnewsImageInput {
  bytes: Buffer;
  mediaType: string;
}

type SupportedMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
function normalizeMime(mime: string): SupportedMime {
  if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) return mime as SupportedMime;
  return "image/png";
}

type Msg = {
  content: Array<{ type: string; text?: string; content?: unknown }>;
  stop_reason?: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};
type MsgParam = { role: "user" | "assistant"; content: unknown };

function textOf(m: Msg | null): string {
  if (!m) return "";
  return m.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
}

function usdOf(r: Msg, model: string): number {
  return anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model,
  });
}

// ----------------------------------------------------------------------------
// ① 카드 이미지 읽기 — 순서대로 한 번에 넣어 복원까지 한 호출로.
// ----------------------------------------------------------------------------
export async function readCardnews(args: {
  images: CardnewsImageInput[];
  projectId?: string;
}): Promise<CardnewsReadResult> {
  const images = args.images ?? [];
  if (images.length === 0) throw new Error("카드 이미지가 없어요");
  if (images.length > CARDNEWS_MAX_IMAGES) {
    throw new Error(`카드 이미지는 ${CARDNEWS_MAX_IMAGES}장까지예요`);
  }

  const content: Array<Record<string, unknown>> = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `카드 ${i + 1}` });
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: normalizeMime(img.mediaType),
        data: img.bytes.toString("base64"),
      },
    });
  });
  content.push({
    type: "text",
    text: `카드 ${images.length}장을 받은 순서대로 읽고 JSON 으로만 답해줘.`,
  });

  const client = getAnthropic();
  const r = (await client.messages.create({
    model: READ_MODEL,
    max_tokens: 8000,
    system: CARDNEWS_READ_SYSTEM,
    messages: [{ role: "user", content: content as never }],
  })) as unknown as Msg;

  const costUsd = usdOf(r, READ_MODEL);
  try {
    await recordCost({
      projectId: args.projectId,
      vendor: "anthropic",
      model: READ_MODEL,
      costUsd,
      meta: { kind: "cardnews-read", cards: images.length },
    });
  } catch {
    /* 비용 기록 실패는 흐름을 끊지 않는다 */
  }

  const raw = textOf(r);
  let parsed: {
    cards?: Array<{ index?: number; text?: string }>;
    title?: string;
    body?: string;
    attributions?: unknown;
  } = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    throw new Error("카드 읽기 응답을 해석 못 했어요. 다시 시도해주세요.");
  }

  const cards: CardnewsCard[] = (parsed.cards ?? [])
    .map((c, i) => ({
      index: typeof c?.index === "number" ? c.index : i + 1,
      text: typeof c?.text === "string" ? c.text.trim() : "",
    }))
    .filter((c) => c.text);

  const body = (parsed.body ?? "").trim();
  if (!body && cards.length === 0) {
    throw new Error("카드에서 읽어낸 글자가 없어요. 다른 이미지로 시도해주세요.");
  }

  const attributions = Array.isArray(parsed.attributions)
    ? parsed.attributions
        .filter((a): a is string => typeof a === "string")
        .map((a) => a.replace(/^[(（]|[)）]$/g, "").trim())
        .filter(Boolean)
    : [];

  return {
    cards,
    title: (parsed.title ?? "").trim() || "(제목 없음)",
    body: body || cards.map((c) => c.text).join("\n\n"),
    attributions,
    costUsd,
  };
}

// ----------------------------------------------------------------------------
// ② 괄호 출처 웹 검색 — 원문을 찾아 관련 사실을 확인한다.
// ----------------------------------------------------------------------------
const webSearchTool = {
  type: "web_search_20260209",
  name: "web_search",
  max_uses: SEARCH_MAX_USES,
};

// 검색 결과 블록에서 링크만 추려 화면에 보여준다(어디서 왔는지 확인용).
function linksOf(m: Msg | null): CardnewsLink[] {
  if (!m) return [];
  const out: CardnewsLink[] = [];
  const seen = new Set<string>();
  for (const block of m.content) {
    if (block.type !== "web_search_tool_result") continue;
    const inner = Array.isArray(block.content) ? block.content : [];
    for (const item of inner as Array<Record<string, unknown>>) {
      const url = typeof item?.url === "string" ? item.url : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({
        title: typeof item?.title === "string" && item.title ? item.title : url,
        url,
      });
    }
  }
  return out;
}

export async function researchCardnews(args: {
  attribution: string;
  title: string;
  body: string;
  projectId?: string;
}): Promise<CardnewsResearchResult> {
  const attribution = (args.attribution ?? "").trim();
  if (!attribution) throw new Error("찾을 출처 표기가 비어 있어요");

  const client = getAnthropic();
  const user = [
    `카드뉴스에 적힌 출처 표기: ${attribution}`,
    "",
    `카드뉴스 주제: ${args.title}`,
    "",
    "카드뉴스 내용:",
    (args.body ?? "").slice(0, 8000),
    "",
    "이 출처를 web_search 로 찾아, 주제와 직접 관련된 사실을 확인해서 정리해줘.",
  ].join("\n");

  const messages: MsgParam[] = [{ role: "user", content: user }];
  let costUsd = 0;
  let searched = false;
  let last: Msg | null = null;
  const links: CardnewsLink[] = [];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    // 검색이 도는 응답은 오래 걸린다 — 스트리밍으로 연결을 살려 둔다.
    const stream = client.messages.stream(
      {
        model: RESEARCH_MODEL,
        max_tokens: 4000,
        system: CARDNEWS_RESEARCH_SYSTEM,
        tools: [webSearchTool] as never,
        messages: messages as never,
      },
      { maxRetries: 0 }
    );
    const r = (await stream.finalMessage()) as unknown as Msg;
    costUsd += usdOf(r, RESEARCH_MODEL);
    if (
      r.content.some(
        (b) => b.type === "web_search_tool_result" || b.type === "server_tool_use"
      )
    ) {
      searched = true;
    }
    for (const l of linksOf(r)) {
      if (!links.some((p) => p.url === l.url)) links.push(l);
    }
    last = r;
    if (r.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: r.content });
      continue;
    }
    break;
  }

  try {
    await recordCost({
      projectId: args.projectId,
      vendor: "anthropic",
      model: RESEARCH_MODEL,
      costUsd,
      meta: { kind: "cardnews-research", searched },
    });
  } catch {
    /* 비용 기록 실패는 흐름을 끊지 않는다 */
  }

  const report = textOf(last);
  // 검색이 안 돌았으면 전부 기억에서 나온 글이다 — 사실로 쓰면 안 된다.
  if (!searched) {
    return {
      report: "",
      links,
      searched: false,
      costUsd,
    };
  }

  return { report, links, searched: true, costUsd };
}
