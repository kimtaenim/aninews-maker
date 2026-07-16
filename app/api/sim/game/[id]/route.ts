import { NextRequest, NextResponse } from "next/server";
import { deleteSimGame, getSimGame } from "@/lib/simStore";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const game = await getSimGame(id);
  if (!game) {
    return NextResponse.json({ ok: false, error: "게임 없음" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, game });
}

// 게임 삭제 — 딸린 플레이 세션도 함께 지운다(simStore 가 처리).
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  await deleteSimGame(id);
  return NextResponse.json({ ok: true });
}
