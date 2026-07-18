import { NextRequest, NextResponse } from "next/server";
import { getCachedFaces, mergeCachedFaces, faceCacheSig } from "@/lib/simStore";
import {
  generateNeutralFace,
  generateExpressionFace,
  EXPRESSION_IDS,
  type FaceId,
} from "@/lib/simFaces";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 120;

// 게임과 무관하게 '캐릭터(name+archetype)'의 표정 얼굴을 만든다 — 캐릭터 캐시로 재사용.
// 관전(자동극장) 인물·주인공 썸네일 등에서 쓴다. backfill 과 같은 조각·스트리밍 방식.
// body: { name, archetype?, description?, expr? }
export async function POST(req: NextRequest) {
  let body: { name?: string; archetype?: string; description?: string; expr?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  const archetype = (body.archetype ?? "").trim();
  const description = (body.description ?? "").trim();
  const expr = (body.expr ?? "").trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "name 필요" }, { status: 400 });
  }
  const sig = faceCacheSig(name, archetype);
  const blobPrefix = `simface/${sig.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}`;
  const cached = await getCachedFaces(sig);

  try {
    if (!expr || expr === "neutral") {
      if (cached.neutral) {
        return NextResponse.json({ ok: true, faces: cached, cost: formatKrw(0), reused: true });
      }
      const neutral = await generateNeutralFace({
        blobPrefix,
        name,
        archetype: archetype || undefined,
        description: description || undefined,
      });
      await mergeCachedFaces(sig, { neutral: neutral.url });
      return NextResponse.json({
        ok: true,
        faces: { neutral: neutral.url },
        cost: formatKrw(neutral.costUsd),
      });
    }

    if (!(EXPRESSION_IDS as string[]).includes(expr)) {
      return NextResponse.json({ ok: false, error: `알 수 없는 표정: ${expr}` }, { status: 400 });
    }
    if (cached[expr]) {
      return NextResponse.json({
        ok: true,
        faces: { [expr]: cached[expr] },
        cost: formatKrw(0),
        reused: true,
      });
    }
    if (!cached.neutral) {
      return NextResponse.json(
        { ok: false, error: "먼저 중립 얼굴을 만들어야 해요" },
        { status: 409 }
      );
    }
    const one = await generateExpressionFace({
      blobPrefix,
      exprId: expr as Exclude<FaceId, "neutral">,
      neutralUrl: cached.neutral,
      targetName: name,
    });
    await mergeCachedFaces(sig, { [expr]: one.url });
    return NextResponse.json({
      ok: true,
      faces: { [expr]: one.url },
      cost: formatKrw(one.costUsd),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "얼굴 생성 실패" },
      { status: 500 }
    );
  }
}
