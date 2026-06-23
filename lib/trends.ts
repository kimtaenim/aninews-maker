// ============================================================================
// Google Trends "Trending Now" RSS — 언어(geo)별 현재 급상승 키워드 Top 10(시간순).
// ----------------------------------------------------------------------------
// pytrends(2025-04 아카이브·429 빈발)를 쓰지 않고, 공식 RSS 피드를 직접 fetch+파싱.
// 라이브 조회라 수집 크론·DB 불필요. 언어·geo 는 config/languages.json 으로 관리
// (하드코딩 X — 언어 추가 시 JSON 만 고치면 됨).
//   피드: https://trends.google.com/trending/rss?geo=KR  (item 10개, pubDate·트래픽 포함)
// ============================================================================

import Parser from "rss-parser";
import langsData from "../config/languages.json";

export interface TrendLang {
  code: string; // 앱 내부 언어 코드(ko/en/ja/es/vi)
  geo: string; // 구글 트렌드 지역 코드(KR/US/JP/ES/VN)
  label: string; // UI 표기(한국어/영어…)
}

const LANGS = (langsData as { languages: TrendLang[] }).languages;

export function listTrendLangs(): TrendLang[] {
  return LANGS;
}
export function getTrendLang(code: string): TrendLang | undefined {
  return LANGS.find((l) => l.code === code);
}

export interface TrendItem {
  keyword: string;
  traffic?: string; // 대략 검색량(예: "2,000+")
  publishedAt: number;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const TIMEOUT_MS = 8000;

const parser: Parser = new Parser({
  timeout: TIMEOUT_MS,
  headers: { "User-Agent": USER_AGENT },
  // 트래픽량은 커스텀 네임스페이스 필드(ht:approx_traffic)에 들어있다.
  customFields: { item: [["ht:approx_traffic", "approxTraffic"]] },
});

// geo 별 짧은 캐시(5분) — 패널을 열 때마다 구글을 때리지 않도록.
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; items: TrendItem[] }>();

export async function fetchTrends(geo: string): Promise<TrendItem[]> {
  const hit = cache.get(geo);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;

  const url = `https://trends.google.com/trending/rss?geo=${encodeURIComponent(geo)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": USER_AGENT,
      Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Google Trends HTTP ${res.status}`);
  const xml = await res.text();
  const feed = await parser.parseString(xml);

  const items: TrendItem[] = (feed.items ?? [])
    .map((it) => ({
      keyword: (it.title ?? "").trim(),
      traffic: (it as { approxTraffic?: string }).approxTraffic?.trim() || undefined,
      publishedAt: it.pubDate ? Date.parse(it.pubDate) : 0,
    }))
    .filter((i) => i.keyword)
    .slice(0, 10);

  cache.set(geo, { at: Date.now(), items });
  return items;
}
