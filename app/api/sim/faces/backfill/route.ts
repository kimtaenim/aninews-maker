import { NextRequest, NextResponse } from "next/server";
import {
  getSimGame,
  mergeTargetFaces,
  getCachedFaces,
  mergeCachedFaces,
  faceCacheSig,
} from "@/lib/simStore";
import {
  generateNeutralFace,
  generateExpressionFace,
  EXPRESSION_IDS,
  type FaceId,
} from "@/lib/simFaces";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 120;

// 게임 상대에게 표정 얼굴을 채워넣는다. 한 요청에 5장을 몰면 48~60s로 브라우저가 먹통이라,
// 조각으로 쪼갠다(클라이언트가 병렬 호출 → 스트리밍):
//   - expr 없음/neutral → 중립 1장(≈18s). 캐시에 있으면 재사용(+캐시된 표정도 함께 반환).
//   - expr=smile|frown|blush|sulk → 저장된 중립 레퍼런스로 그 표정 1장(≈32s).
// 얼굴은 name+archetype 로만 결정되므로 그 시그니처로 캐시 → '게임 만들 때마다 재생성' 방지.
// body: { gameId: string, targetName: string, expr?: FaceId }
export async function POST(req: NextRequest) {
  let body: { gameId?: string; targetName?: string; expr?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const gameId = (body.gameId ?? "").trim();
  const targetName = (body.targetName ?? "").trim();
  const expr = (body.expr ?? "").trim();
  if (!gameId || !targetName) {
    return NextResponse.json({ ok: false, error: "gameId·targetName 필요" }, { status: 400 });
  }
  const game = await getSimGame(gameId);
  if (!game) {
    return NextResponse.json({ ok: false, error: "게임 없음" }, { status: 404 });
  }
  const target = game.targets.find((t) => t.name === targetName);
  if (!target) {
    return NextResponse.json({ ok: false, error: "상대를 찾을 수 없어요" }, { status: 400 });
  }
  const blobPrefix = `simgame/${gameId}`;
  const sig = faceCacheSig(target.name, target.archetype);
  const cached = await getCachedFaces(sig);

  try {
    // ── 중립 모드 ──
    if (!expr || expr === "neutral") {
      if (cached.neutral) {
        // 재사용 — 생성 안 함. 캐시에 있는 표정까지 한 번에 넘겨 클라가 나머지 요청을 건너뛰게 한다.
        await mergeTargetFaces(gameId, targetName, cached);
        return NextResponse.json({ ok: true, faces: cached, cost: formatKrw(0), reused: true });
      }
      const neutral = await generateNeutralFace({
        blobPrefix,
        projectId: gameId,
        name: target.name,
        archetype: target.archetype,
      });
      await mergeTargetFaces(gameId, targetName, { neutral: neutral.url });
      await mergeCachedFaces(sig, { neutral: neutral.url });
      return NextResponse.json({
        ok: true,
        faces: { neutral: neutral.url },
        cost: formatKrw(neutral.costUsd),
      });
    }

    // ── 표정 1장 모드 ──
    if (!(EXPRESSION_IDS as string[]).includes(expr)) {
      return NextResponse.json({ ok: false, error: `알 수 없는 표정: ${expr}` }, { status: 400 });
    }
    if (cached[expr]) {
      // 재사용 — 생성 안 함.
      await mergeTargetFaces(gameId, targetName, { [expr]: cached[expr] });
      return NextResponse.json({
        ok: true,
        faces: { [expr]: cached[expr] },
        cost: formatKrw(0),
        reused: true,
      });
    }
    const neutralUrl = target.faces?.neutral || cached.neutral;
    if (!neutralUrl) {
      return NextResponse.json(
        { ok: false, error: "먼저 중립 얼굴을 만들어야 해요" },
        { status: 409 }
      );
    }
    const one = await generateExpressionFace({
      blobPrefix,
      exprId: expr as Exclude<FaceId, "neutral">,
      neutralUrl,
      projectId: gameId,
      targetName,
    });
    await mergeTargetFaces(gameId, targetName, { [expr]: one.url });
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
