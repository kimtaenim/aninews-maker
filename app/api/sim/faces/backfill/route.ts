import { NextRequest, NextResponse } from "next/server";
import { getSimGame, saveSimGame } from "@/lib/simStore";
import { generateExpressionFaces } from "@/lib/simFaces";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 300;

// 이미 만든 게임의 상대에게 표정 얼굴을 채워넣는다(얼굴 없이 만들어진 게임 복구용).
// body: { gameId: string, targetName: string }
export async function POST(req: NextRequest) {
  let body: { gameId?: string; targetName?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const gameId = (body.gameId ?? "").trim();
  const targetName = (body.targetName ?? "").trim();
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

  try {
    const { faces, costUsd } = await generateExpressionFaces({
      blobPrefix: `simgame/${gameId}`,
      projectId: gameId,
      name: target.name,
      archetype: target.archetype,
    });
    // 긴 생성 뒤 fresh 재읽기 → 해당 상대 faces 만 머지(통째 저장 회피).
    const fresh = await getSimGame(gameId);
    if (!fresh) {
      return NextResponse.json({ ok: false, error: "게임이 사라졌어요" }, { status: 404 });
    }
    fresh.targets = fresh.targets.map((t) => (t.name === targetName ? { ...t, faces } : t));
    fresh.updatedAt = Date.now();
    await saveSimGame(fresh);
    return NextResponse.json({ ok: true, faces, cost: formatKrw(costUsd) });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "얼굴 생성 실패" },
      { status: 500 }
    );
  }
}
