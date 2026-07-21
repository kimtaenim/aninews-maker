import { NextRequest, NextResponse } from "next/server";
import { getSimGame, getSimPlay, saveSimPlay } from "@/lib/simStore";
import { judgeTurn, rescheduleSituation } from "@/lib/simChat";
import { SIM_SITUATIONS } from "@/lib/simSituations";

export const runtime = "nodejs";
export const maxDuration = 60;

// 한 턴 진행 — 플레이어 메시지를 채점해 친밀도를 갱신하고 상대의 답을 돌려준다.
// body: { playId: string, message: string }
export async function POST(req: NextRequest) {
  let body: { playId?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const playId = (body.playId ?? "").trim();
  const message = (body.message ?? "").trim();
  if (!playId || !message) {
    return NextResponse.json({ ok: false, error: "playId·message 필요" }, { status: 400 });
  }

  // 긴 생성 호출 전/후 모두 fresh 로 읽어 필드만 갱신(통째 저장 회피).
  const play = await getSimPlay(playId);
  if (!play) {
    return NextResponse.json({ ok: false, error: "플레이 세션 없음" }, { status: 404 });
  }
  if (play.status !== "playing") {
    return NextResponse.json({ ok: false, error: "이미 끝난 게임이에요" }, { status: 400 });
  }
  const game = await getSimGame(play.gameId);
  if (!game) {
    return NextResponse.json({ ok: false, error: "게임 없음" }, { status: 404 });
  }
  const target = game.targets.find((t) => t.name === play.targetName);
  if (!target) {
    return NextResponse.json({ ok: false, error: "상대를 찾을 수 없어요" }, { status: 400 });
  }

  // 플레이어 턴을 이력에 넣고 판정.
  play.turns.push({ role: "user", text: message, ts: Date.now() });

  let result;
  try {
    result = await judgeTurn(game, target, play);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "판정 실패" },
      { status: 500 }
    );
  }

  // 상태 반영.
  play.like = result.like;
  play.dislike = result.dislike;
  play.sulking = result.sulking;
  play.sulkReason = result.sulkReason;
  play.memory = result.memory;
  play.turns.push({
    role: "assistant",
    text: result.reply,
    likeDelta: result.likeDelta,
    dislikeDelta: result.dislikeDelta,
    sulking: result.sulking,
    situationId: result.situationId,
    ts: Date.now(),
  });
  if (result.situationId && !play.situationsUsed.includes(result.situationId)) {
    play.situationsUsed.push(result.situationId);
    const assistantTurns = play.turns.filter((t) => t.role === "assistant").length;
    play.nextSituationAtTurn = rescheduleSituation(assistantTurns);
  }
  if (result.crossedMilestone && !play.milestonesSeen.includes(result.crossedMilestone)) {
    play.milestonesSeen.push(result.crossedMilestone);
  }
  if (result.ending) {
    play.status = result.ending;
    play.endedReason = result.endedReason;
  }
  play.updatedAt = Date.now();
  await saveSimPlay(play);

  // 이번 턴에 넘은 마일스톤에 걸린 컷씬(있으면) — PoC 는 배너, M3 에서 영상 재생.
  const cutscene =
    result.crossedMilestone != null
      ? target.cutscenes.find((c) => c.at === result.crossedMilestone)
      : undefined;
  const situationLabel = result.situationId
    ? SIM_SITUATIONS.find((s) => s.id === result.situationId)?.label
    : undefined;

  return NextResponse.json({
    ok: true,
    reply: result.reply,
    moves: result.moves ?? [],
    like: play.like,
    dislike: play.dislike,
    costUsd: result.costUsd,
    sulking: play.sulking,
    justSulked: result.justSulked,
    justSoothed: result.justSoothed,
    situationLabel,
    crossedMilestone: result.crossedMilestone,
    cutscene: cutscene
      ? { at: cutscene.at, videoUrl: cutscene.videoUrl, title: cutscene.title }
      : undefined,
    status: play.status,
    endedReason: play.endedReason,
  });
}
