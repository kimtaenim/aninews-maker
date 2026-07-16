import { NextRequest, NextResponse } from "next/server";
import { generateSimPersona } from "@/lib/simPersona";

export const runtime = "nodejs";
export const maxDuration = 60;

// 페르소나 초안 생성 — 제조기 2단계에서 상대별 1회(Haiku). 사용자가 수정해 확정.
// body: { name: string, archetype?: string }
export async function POST(req: NextRequest) {
  let body: { name?: string; archetype?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "name 필요" }, { status: 400 });
  }
  try {
    const { persona } = await generateSimPersona({
      name,
      archetype: (body.archetype ?? "").trim() || undefined,
    });
    return NextResponse.json({ ok: true, persona });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "페르소나 생성 실패" },
      { status: 500 }
    );
  }
}
