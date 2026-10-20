import { NextRequest, NextResponse } from "next/server";
import { researchCardnews } from "@/lib/cardnews";

export const runtime = "nodejs";
export const maxDuration = 300; // 웹 검색 여러 번 — 넉넉히

// [카드뉴스 ②] 카드뉴스 괄호 출처 → web_search 로 원문·관련 사실 확인.
// 화면에서 출처를 고쳐 다시 부를 수 있다. 프로젝트는 만들지 않는다.
//
// JSON: { attribution, title, body }
export async function POST(req: NextRequest) {
  let payload: { attribution?: unknown; title?: unknown; body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const attribution =
    typeof payload.attribution === "string" ? payload.attribution.trim() : "";
  if (!attribution) {
    return NextResponse.json(
      { ok: false, error: "출처 표기를 입력해주세요" },
      { status: 400 }
    );
  }

  try {
    const research = await researchCardnews({
      attribution,
      title: typeof payload.title === "string" ? payload.title : "",
      body: typeof payload.body === "string" ? payload.body : "",
    });
    return NextResponse.json({ ok: true, ...research });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "출처 검색 실패" },
      { status: 500 }
    );
  }
}
