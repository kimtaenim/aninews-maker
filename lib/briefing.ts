// ============================================================================
// RSS 브리핑 (1단계 보강) — 고른 기사 여러 개를 한 번에 요약해 "고르기 좋게" 만든다
// ----------------------------------------------------------------------------
// 사용자가 RSS 목록에서 후보 기사를 여러 개 체크하면, 각 기사 본문을 추출하고
// Claude(Haiku)로 2~3문장 한국어 브리핑을 만든다. 사용자는 그 브리핑을 보고
// 최종으로 넣을 기사들을 고른 뒤 from-url(urls[])로 보내 mergeSources 로 합친다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { extractFromUrl } from "./source";

export interface BriefInput {
  link: string;
  title?: string;
  summary?: string; // RSS 요약 — 본문 추출 실패 시 폴백
}

export interface ArticleBriefing {
  link: string;
  title: string;
  sourceName: string;
  briefing: string; // Claude 가 만든 2~3문장 한국어 브리핑
  fetched: boolean; // 본문 추출 성공 여부(실패면 RSS 요약 기반)
}

const MAX_ARTICLES = 12;
const MAX_PER_ARTICLE = 6000; // 기사당 본문 컷(토큰 절약)
const MAX_TOTAL = 50_000;

export async function briefArticles(args: {
  items: BriefInput[];
  projectId?: string;
}): Promise<{ briefings: ArticleBriefing[]; costUsd: number }> {
  const items = (args.items ?? []).filter((x) => x?.link?.trim()).slice(0, MAX_ARTICLES);
  if (items.length === 0) throw new Error("브리핑할 기사가 없어요");

  // 1) 본문 추출(병렬). 실패하면 RSS 요약으로 폴백.
  const settled = await Promise.allSettled(items.map((it) => extractFromUrl(it.link)));
  const prepared = items.map((it, i) => {
    const r = settled[i];
    if (r.status === "fulfilled" && r.value.body.trim()) {
      return {
        link: it.link,
        title: r.value.title || it.title || "(제목 없음)",
        sourceName: r.value.sourceName || "",
        body: r.value.body.slice(0, MAX_PER_ARTICLE),
        fetched: true,
      };
    }
    return {
      link: it.link,
      title: it.title || "(제목 없음)",
      sourceName: "",
      body: (it.summary || "").slice(0, MAX_PER_ARTICLE),
      fetched: false,
    };
  });

  // 2) 한 번의 Claude 호출로 전 기사 브리핑(순서 유지).
  const client = getAnthropic();
  const system =
    "You write concise Korean briefings to help a user pick which news to turn into a short video. " +
    "For EACH article, write 2-3 short Korean sentences: what happened + why it matters. Factual, neutral. " +
    'Output ONLY JSON: {"briefings":[{"index":0,"briefing":"..."}]} — same order, one per article, no markdown.';
  const joined = prepared
    .map((p, i) => `--- 기사 ${i} ---\n제목: ${p.title}\n${p.body || "(본문 없음)"}`)
    .join("\n\n")
    .slice(0, MAX_TOTAL);
  const userMsg = `다음 기사들을 각각 2~3문장 한국어로 브리핑해줘:\n\n${joined}\n\nJSON 만: {"briefings":[{"index":0,"briefing":"..."}]}`;

  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 4000,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const raw = (
    r.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>
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
  try {
    await recordCost({
      projectId: args.projectId,
      vendor: "anthropic",
      model: MODELS.haiku,
      costUsd,
      meta: { kind: "briefing", count: prepared.length },
    });
  } catch {
    /* 비용 기록 실패는 무시 */
  }

  const byIndex = new Map<number, string>();
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = (m ? JSON.parse(m[0]) : {}) as {
      briefings?: Array<{ index?: number; briefing?: string }>;
    };
    for (const b of parsed.briefings ?? []) {
      if (typeof b.index === "number") byIndex.set(b.index, (b.briefing || "").trim());
    }
  } catch {
    /* 파싱 실패 시 폴백 */
  }

  const briefings: ArticleBriefing[] = prepared.map((p, i) => ({
    link: p.link,
    title: p.title,
    sourceName: p.sourceName,
    briefing:
      byIndex.get(i) ||
      (p.fetched
        ? "(브리핑 생성 실패 — 제목으로 판단해주세요)"
        : `본문을 못 불러왔어요. 원문 요약: ${(items[i].summary || "").slice(0, 160) || "(없음)"}`),
    fetched: p.fetched,
  }));

  return { briefings, costUsd };
}
