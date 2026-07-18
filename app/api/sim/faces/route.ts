import { NextRequest, NextResponse } from "next/server";
import { generateExpressionFaces } from "@/lib/simFaces";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 300; // 5장 생성은 수십 초~1분+

// 표정 얼굴 세트 생성 — 제조기에서 캐릭터별 1회. 무상태(Blob 업로드 → URL 반환).
// body: { draftId: string, name?, archetype?, description? }
export async function POST(req: NextRequest) {
  let body: { draftId?: string; name?: string; archetype?: string; description?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const draftId = (body.draftId ?? "").trim().replace(/[^\w-]/g, "").slice(0, 64);
  if (!draftId) {
    return NextResponse.json({ ok: false, error: "draftId 필요" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const archetype = (body.archetype ?? "").trim();
  if (!name && !archetype) {
    return NextResponse.json({ ok: false, error: "이름 또는 성격이 필요해요" }, { status: 400 });
  }
  try {
    const { faces, costUsd } = await generateExpressionFaces({
      blobPrefix: `casting/simface-${draftId}`,
      name: name || undefined,
      archetype: archetype || undefined,
      description: (body.description ?? "").trim() || undefined,
    });
    return NextResponse.json({ ok: true, faces, cost: formatKrw(costUsd) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "표정 생성 실패" },
      { status: 500 }
    );
  }
}
