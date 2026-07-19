import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { createLongformFromShorts } from "@/lib/longform";

export const runtime = "nodejs";
export const maxDuration = 60;

// 롱폼 묶기 — 선택한 숏폼 id들(순서대로)로 세그먼트 N개 + 롱폼 프로젝트를 만든다.
// 재생성(16:9)·아이캐치·최종 이어붙이기는 이후 단계(스튜디오 파이프라인 + /api/compose).
//   POST { shortIds: string[] }  → { ok, longformId, segmentIds }
export async function POST(req: NextRequest) {
  let body: { shortIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const shortIds = Array.isArray(body.shortIds)
    ? body.shortIds.filter((x): x is string => typeof x === "string")
    : [];
  if (shortIds.length === 0) {
    return NextResponse.json({ ok: false, error: "묶을 숏폼을 골라주세요" }, { status: 400 });
  }

  try {
    const ownerEmail = (await getSessionEmail()) ?? undefined;
    const { longformId, segmentIds } = await createLongformFromShorts(shortIds, ownerEmail);
    return NextResponse.json({ ok: true, longformId, segmentIds });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "롱폼 묶기 실패" },
      { status: 400 }
    );
  }
}
