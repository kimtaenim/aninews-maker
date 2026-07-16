import { NextRequest, NextResponse } from "next/server";
import { getSimGame, createSimPlay, saveSimPlay } from "@/lib/simStore";
import { generateOpening, rescheduleSituation } from "@/lib/simChat";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

// 플레이 세션 시작 — 상대를 정하고, 상대가 먼저 인사(오프닝)를 건다.
// body: { gameId: string, targetName?: string }  (targetName 없으면 첫 상대)
export async function POST(req: NextRequest) {
  let body: { gameId?: string; targetName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const gameId = (body.gameId ?? "").trim();
  if (!gameId) {
    return NextResponse.json({ ok: false, error: "gameId 필요" }, { status: 400 });
  }
  const game = await getSimGame(gameId);
  if (!game) {
    return NextResponse.json({ ok: false, error: "게임 없음" }, { status: 404 });
  }
  const targetName = (body.targetName ?? "").trim();
  const target = targetName
    ? game.targets.find((t) => t.name === targetName)
    : game.targets[0];
  if (!target) {
    return NextResponse.json({ ok: false, error: "상대를 찾을 수 없어요" }, { status: 400 });
  }

  try {
    const play = await createSimPlay({
      gameId,
      targetName: target.name,
      nextSituationAtTurn: rescheduleSituation(0), // 첫 상황은 4~7번째 응답 사이
      ownerEmail: (await getSessionEmail()) ?? undefined,
    });

    const opening = await generateOpening(game, target);
    play.turns.push({ role: "assistant", text: opening, ts: Date.now() });
    play.updatedAt = Date.now();
    await saveSimPlay(play);

    return NextResponse.json({
      ok: true,
      playId: play.id,
      target: {
        name: target.name,
        archetype: target.archetype ?? "",
        portraitUrl: target.portraitUrl ?? "",
      },
      affinity: play.affinity,
      opening,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "세션 시작 실패" },
      { status: 500 }
    );
  }
}
