import { NextRequest, NextResponse } from "next/server";
import { briefArticles, type BriefInput } from "@/lib/briefing";

export const runtime = "nodejs";
export const maxDuration = 60;

// 1. source (RSS 브리핑) — 고른 기사 여러 개의 본문을 추출·요약해 브리핑 반환.
// 사용자는 이 브리핑을 보고 최종 기사를 골라 from-url(urls[])로 보낸다.
// body: { articles: [{ link, title?, summary? }] }
export async function POST(req: NextRequest) {
  let body: { articles?: BriefInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const items = (Array.isArray(body.articles) ? body.articles : [])
    .filter((x) => x?.link?.trim())
    .slice(0, 12);
  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, error: "기사를 1개 이상 선택해주세요" },
      { status: 400 }
    );
  }

  try {
    const { briefings } = await briefArticles({ items });
    return NextResponse.json({ ok: true, briefings });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "브리핑 실패" },
      { status: 500 }
    );
  }
}
