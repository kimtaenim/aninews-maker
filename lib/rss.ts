// ============================================================================
// RSS 수집 (1단계) — cardnews lib/rss.ts 이식, aninews 용으로 슬림화
// ----------------------------------------------------------------------------
// 카테고리별 피드를 읽어 최신 기사 목록을 돌려준다(최신순). RSS 본문은 요약만
// 있으므로, 사용자가 기사를 고르면 그 link 를 extractFromUrl 로 전체 본문 추출해
// 소스로 쓴다. 종합(여러 기사 병합)은 다음 단계에서.
// ============================================================================

import Parser from "rss-parser";
import rssData from "../config/rss-feeds.json";

interface RssFeed {
  name: string;
  url: string;
  lang: string;
}

export interface RssItem {
  id: string;
  feedName: string;
  feedLang: string;
  title: string;
  link: string;
  summary: string;
  publishedAt: number;
}

export interface RssCategory {
  key: string;
  label: string;
}

const PER_FEED_TIMEOUT_MS = 8000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const parser: Parser = new Parser({
  timeout: PER_FEED_TIMEOUT_MS,
  headers: {
    "User-Agent": USER_AGENT,
    Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
  },
});

const rss = rssData as {
  categories: Record<string, { label: string; feeds: RssFeed[] }>;
};

export function listCategories(): RssCategory[] {
  return Object.entries(rss.categories).map(([key, v]) => ({
    key,
    label: v.label,
  }));
}

function itemId(
  item: { link?: string; guid?: string; title?: string },
  feed: RssFeed
): string {
  return (item.link || item.guid || `${feed.name}:${item.title ?? ""}`).slice(0, 256);
}

async function fetchOneFeed(
  feed: RssFeed,
  fromMs: number,
  toMs: number
): Promise<RssItem[]> {
  const timer = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PER_FEED_TIMEOUT_MS + 500)
  );
  try {
    const result = await Promise.race([parser.parseURL(feed.url), timer]);
    if (!result) return [];
    const out: RssItem[] = [];
    for (const item of result.items ?? []) {
      const dateStr = item.isoDate ?? item.pubDate ?? null;
      if (!dateStr) continue;
      const ts = Date.parse(dateStr);
      if (Number.isNaN(ts) || ts < fromMs || ts > toMs) continue;
      const summary = (item.contentSnippet ?? item.content ?? "").trim();
      out.push({
        id: itemId(item, feed),
        feedName: feed.name,
        feedLang: feed.lang,
        title: (item.title ?? "(제목 없음)").trim(),
        link: item.link ?? "",
        summary: summary.length > 300 ? summary.slice(0, 300) + "…" : summary,
        publishedAt: ts,
      });
    }
    return out;
  } catch {
    return [];
  }
}

// 카테고리 피드들 수집 → 윈도우 필터 → 중복 제거 → 최신순 정렬 → count 만큼.
export async function fetchCategoryArticles(opts: {
  category: string;
  days?: number;
  count?: number;
}): Promise<RssItem[]> {
  const days = Math.max(1, Math.min(30, opts.days ?? 7));
  const count = Math.max(1, Math.min(50, opts.count ?? 30));

  const feeds = rss.categories?.[opts.category]?.feeds ?? [];
  if (feeds.length === 0) return [];

  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;

  const settled = await Promise.allSettled(
    feeds.map((f) => fetchOneFeed(f, fromMs, toMs))
  );

  const seen = new Set<string>();
  const all: RssItem[] = [];
  for (const s of settled) {
    if (s.status !== "fulfilled") continue;
    for (const a of s.value) {
      if (seen.has(a.id) || !a.link) continue;
      seen.add(a.id);
      all.push(a);
    }
  }
  // 최신순 (피드 고를 때는 셔플보다 최신이 유용)
  all.sort((a, b) => b.publishedAt - a.publishedAt);
  return all.slice(0, count);
}
