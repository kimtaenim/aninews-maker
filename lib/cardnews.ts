// ============================================================================
// 카드뉴스 입력 — PNG/JPG 카드 → 꼭지별 글자 읽기 → 끝 괄호 출처 → 웹 검색 확인
// ----------------------------------------------------------------------------
// 카드 한 장 = 뉴스 한 꼭지다(장끼리 이어지지 않는다). 꼭지마다 제목·본문·출처가
// 따로 있어서 읽기도 검색도 꼭지 단위로 돈다. 여러 꼭지를 한 편으로 묶는 일은
// 기존 lib/mergeSources.ts 가 한다 — 여기서 다시 만들지 않는다.
//
// 1) readCardnews       — 카드들을 한 번의 vision 호출로 읽어 꼭지 배열로.
// 2) researchCardnews   — 꼭지 하나의 출처를 web_search 로 찾아 사실을 확인한다.
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
// 검색 결과가 토큰으로 들어와 매 턴 재전송된다 — 횟수가 곧 비용이고 기다리는 시간이다.
// 출처 하나를 확인하는 일이라 넉넉할 필요가 없다.
const SEARCH_MAX_USES = 3;
const MAX_ROUNDS = 2;

// 카드 한 장에서 읽어낸 뉴스 한 꼭지.
export interface CardnewsItem {
  index: number;
  title: string;
  body: string;
  attribution: string; // 본문 맨 끝 괄호 안 출처. 없으면 "".
}

export interface CardnewsReadResult {
  items: CardnewsItem[];
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
// ① 카드 이미지 읽기 — 장마다 따로, 동시에.
// ----------------------------------------------------------------------------
// 카드는 서로 독립된 꼭지라 한 호출에 몰아넣을 이유가 없다. 몰아넣으면 장수만큼
// 출력 토큰이 쌓여 기다리는 시간도 그만큼 길어진다. 장별로 쪼개 동시에 보내면
// 전체 시간이 가장 느린 한 장만큼으로 줄어든다.
export async function readCardnews(args: {
  images: CardnewsImageInput[];
  projectId?: string;
}): Promise<CardnewsReadResult> {
  const images = args.images ?? [];
  if (images.length === 0) throw new Error("카드 이미지가 없어요");
  if (images.length > CARDNEWS_MAX_IMAGES) {
    throw new Error(`카드 이미지는 ${CARDNEWS_MAX_IMAGES}장까지예요`);
  }

  const client = getAnthropic();
  const results = await Promise.allSettled(
    images.map(async (img) => {
      const r = (await client.messages.create({
        model: READ_MODEL,
        max_tokens: 2000, // 한 꼭지 분량이면 충분하다
        system: CARDNEWS_READ_SYSTEM,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: normalizeMime(img.mediaType),
                  data: img.bytes.toString("base64"),
                },
              },
              { type: "text", text: "이 카드 한 장을 한 꼭지로 읽고 JSON 으로만 답해줘." },
            ] as never,
          },
        ],
      })) as unknown as Msg;
      return { item: parseCardnewsRead(textOf(r))[0], costUsd: usdOf(r, READ_MODEL) };
    })
  );

  // 한 장이 실패해도 나머지로 진행한다. 번호는 올린 순서를 그대로 쓴다.
  const items: CardnewsItem[] = [];
  let costUsd = 0;
  results.forEach((res, i) => {
    if (res.status !== "fulfilled" || !res.value.item) return;
    costUsd += res.value.costUsd;
    items.push({ ...res.value.item, index: i + 1 });
  });
  if (items.length === 0) {
    throw new Error("카드에서 읽어낸 글자가 없어요. 다른 이미지로 시도해주세요.");
  }

  try {
    await recordCost({
      projectId: args.projectId,
      vendor: "anthropic",
      model: READ_MODEL,
      costUsd,
      meta: { kind: "cardnews-read", cards: images.length, read: items.length },
    });
  } catch {
    /* 비용 기록 실패는 흐름을 끊지 않는다 */
  }

  return { items, costUsd };
}

// 모델 응답 → 꼭지 배열. 순수 함수 — scripts/test-cardnews-parse.ts 로 검증한다.
export function parseCardnewsRead(raw: string): CardnewsItem[] {
  let parsed: {
    items?: Array<{
      index?: number;
      title?: string;
      body?: string;
      attribution?: string;
    }>;
  } = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    throw new Error("카드 읽기 응답을 해석 못 했어요. 다시 시도해주세요.");
  }

  const items: CardnewsItem[] = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((it, i) => ({
      index: typeof it?.index === "number" ? it.index : i + 1,
      title: typeof it?.title === "string" ? it.title.trim() : "",
      body: typeof it?.body === "string" ? it.body.trim() : "",
      attribution: normalizeAttribution(it?.attribution),
    }))
    .filter((it) => it.title || it.body);

  if (items.length === 0) {
    throw new Error("카드에서 읽어낸 글자가 없어요. 다른 이미지로 시도해주세요.");
  }
  return items;
}

// 모델이 괄호째 돌려주는 경우가 있어 양끝 괄호만 벗긴다. 본문 중간 괄호와는 무관하다.
function normalizeAttribution(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().replace(/^[(（]\s*/, "").replace(/\s*[)）]$/, "").trim();
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
