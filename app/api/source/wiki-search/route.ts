import { NextRequest, NextResponse } from "next/server";
import { searchWikipedia } from "@/lib/wikipedia";

export const runtime = "nodejs";
export const maxDuration = 30;

// 위키 검색 — 검색어로 한·영 위키 관련 문서 후보를 반환. 사용자가 하나 골라
// from-wiki 로 보낸다. body: { query }
export async function POST(req: NextRequest) {
  let body: { query?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const query = (body.query ?? "").trim();
  if (!query) {
    return NextResponse.json({ ok: false, error: "검색어를 입력해주세요" }, { status: 400 });
  }
  try {
    const results = await searchWikipedia(query);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "위키 검색 실패" },
      { status: 502 }
    );
  }
}
