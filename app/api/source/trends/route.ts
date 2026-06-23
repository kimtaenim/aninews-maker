import { NextRequest, NextResponse } from "next/server";
import { fetchTrends, getTrendLang } from "@/lib/trends";

export const runtime = "nodejs";
export const maxDuration = 20;

// 언어별 구글 트렌드 현재 급상승 Top 10(시간순). GET ?lang=ko
// 키워드를 고르면 프론트가 기존 위키 검색(/api/source/wiki-search)으로 넘긴다.
export async function GET(req: NextRequest) {
  const lang = (req.nextUrl.searchParams.get("lang") ?? "ko").trim();
  const def = getTrendLang(lang);
  if (!def) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 언어" }, { status: 400 });
  }
  try {
    const items = await fetchTrends(def.geo);
    return NextResponse.json({ ok: true, lang: def.code, items });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "트렌드 수집 실패" },
      { status: 502 }
    );
  }
}
