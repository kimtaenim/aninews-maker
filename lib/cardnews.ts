// ============================================================================
// 카드뉴스 입력 — PNG/JPG 카드 → 꼭지별 글자 읽기(제목·본문·끝 괄호 출처)
// ----------------------------------------------------------------------------
// 카드 한 장 = 뉴스 한 꼭지다(장끼리 이어지지 않는다). 꼭지마다 제목·본문·출처가
// 따로 있어서 읽기도 꼭지 단위로 돈다. 여러 꼭지를 한 편으로 묶는 일은 기존
// lib/mergeSources.ts 가 한다 — 여기서 다시 만들지 않는다.
//
// 출처는 카드에 적힌 표기를 그대로 옮기기만 한다. 사실 확인은 카드뉴스를 만드는
// 쪽에서 이미 하므로 여기서 웹 검색을 돌리지 않는다.
// 대본은 기존 대본 단계가 만든다 — 여기서 만들지 않는다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { CARDNEWS_READ_SYSTEM } from "./cardnewsPrompt";

export const CARDNEWS_MAX_IMAGES = 12;

// 카드 하단의 작은 괄호 출처를 놓치면 이 기능 전체가 무의미하다 — 읽기는 sonnet.
const READ_MODEL = MODELS.sonnet;

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
  content: Array<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
  };
};

function textOf(m: Msg): string {
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
