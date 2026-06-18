import { NextRequest, NextResponse } from "next/server";
import { listCategories, fetchCategoryArticles } from "@/lib/rss";

export const runtime = "nodejs";
export const maxDuration = 30;

// 1. source (RSS)
//   GET /api/source/rss            → { categories: [{key,label}] }
//   GET /api/source/rss?category=X → { articles: RssItem[] } (최신순)
export async function GET(req: NextRequest) {
  const category = req.nextUrl.searchParams.get("category");
  if (!category) {
    return NextResponse.json({ ok: true, categories: listCategories() });
  }
  try {
    const { items, feedsTotal, failures } = await fetchCategoryArticles({ category });
    return NextResponse.json({
      ok: true,
      articles: items,
      feedsTotal,
      failedFeeds: failures, // [{feed,error}] — UI에서 "N개 피드 못 읽음" 안내용
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "RSS 수집 실패" },
      { status: 502 }
    );
  }
}
