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

interface FeedResult {
  items: RssItem[];
  error?: string; // 실패 사유(403 등) — UI 노출용
}

// rss-parser 의 parseURL 대신 직접 fetch(풀 브라우저 헤더 + 리다이렉트) 후 parseString.
// 많은 피드가 단순 parseURL 요청을 403/406 으로 막아서, 헤더를 제대로 실어 보낸다.
async function fetchOneFeed(
  feed: RssFeed,
  fromMs: number,
  toMs: number
): Promise<FeedResult> {
  try {
    const res = await fetch(feed.url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.7",
        "Accept-Language": "ko,en-US;q=0.8,en;q=0.6",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(PER_FEED_TIMEOUT_MS),
    });
    if (!res.ok) return { items: [], error: `HTTP ${res.status}` };
    const xml = await res.text();
    const result = await parser.parseString(xml);

    const out: RssItem[] = [];
    for (const item of result.items ?? []) {
      const dateStr = item.isoDate ?? item.pubDate ?? null;
      let ts = dateStr ? Date.parse(dateStr) : NaN;
      if (Number.isNaN(ts)) {
        ts = 0; // 날짜 없는 피드 — 버리지 말고 포함(정렬상 맨 뒤). 윈도우 필터는 건너뜀.
      } else if (ts < fromMs || ts > toMs) {
        continue;
      }
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
    return { items: out };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "수집 실패";
    return { items: [], error: /aborted|timeout/i.test(msg) ? "시간 초과" : msg };
  }
}

export interface CategoryResult {
  items: RssItem[];
  feedsTotal: number;
  failures: { feed: string; error: string }[]; // 못 읽은 피드와 사유(UI 노출)
}

// 카테고리 피드들 수집 → 윈도우 필터 → 중복 제거 → 최신순 정렬 → count 만큼.
export async function fetchCategoryArticles(opts: {
  category: string;
  days?: number;
  count?: number;
}): Promise<CategoryResult> {
  const days = Math.max(1, Math.min(30, opts.days ?? 7));
  const count = Math.max(1, Math.min(50, opts.count ?? 30));

  const feeds = rss.categories?.[opts.category]?.feeds ?? [];
  if (feeds.length === 0) return { items: [], feedsTotal: 0, failures: [] };

  const toMs = Date.now();
  const fromMs = toMs - days * 24 * 60 * 60 * 1000;

  const settled = await Promise.allSettled(
    feeds.map((f) => fetchOneFeed(f, fromMs, toMs))
  );

  const seen = new Set<string>();
  const all: RssItem[] = [];
  const failures: { feed: string; error: string }[] = [];
  settled.forEach((s, i) => {
    if (s.status !== "fulfilled") {
      failures.push({ feed: feeds[i].name, error: String(s.reason).slice(0, 80) });
      return;
    }
    if (s.value.error) failures.push({ feed: feeds[i].name, error: s.value.error });
    for (const a of s.value.items) {
      if (seen.has(a.id) || !a.link) continue;
      seen.add(a.id);
      all.push(a);
    }
  });
  // 최신순 (피드 고를 때는 셔플보다 최신이 유용). 날짜 없는 항목(0)은 자연히 뒤로.
  all.sort((a, b) => b.publishedAt - a.publishedAt);
  return { items: all.slice(0, count), feedsTotal: feeds.length, failures };
}
