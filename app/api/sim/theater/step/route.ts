import { NextRequest, NextResponse } from "next/server";
import { getSimTheater, saveSimTheater } from "@/lib/simTheaterStore";
import { theaterStep } from "@/lib/simTheater";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 60;

// 자동극장 한 턴 진행('다음'). 중간에 난입 상황을 함께 던질 수 있다.
// body: { theaterId: string, injection?: string }
export async function POST(req: NextRequest) {
  let body: { theaterId?: string; injection?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const theaterId = (body.theaterId ?? "").trim();
  if (!theaterId) {
    return NextResponse.json({ ok: false, error: "theaterId 필요" }, { status: 400 });
  }
  const theater = await getSimTheater(theaterId);
  if (!theater) {
    return NextResponse.json({ ok: false, error: "극장 없음" }, { status: 404 });
  }

  const injection = (body.injection ?? "").trim();
  let result;
  try {
    result = await theaterStep(theater, injection);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "진행 실패" },
      { status: 500 }
    );
  }

  // 긴 생성 뒤 fresh 재읽기 → 이번 턴 결과만 반영(통째 저장 회피).
  const fresh = (await getSimTheater(theaterId)) ?? theater;
  fresh.turns.push({
    speaker: result.speaker,
    text: result.reply,
    situation: injection || undefined,
    ts: Date.now(),
  });
  fresh.feelings = result.feelings;
  fresh.nextSpeakerIdx = result.nextSpeakerIdx;
  fresh.updatedAt = Date.now();
  await saveSimTheater(fresh);

  return NextResponse.json({
    ok: true,
    speaker: result.speaker,
    reply: result.reply,
    deltas: result.deltas,
    feelings: result.feelings,
    nextSpeaker: fresh.cast[result.nextSpeakerIdx]?.name,
    cost: formatKrw(result.costUsd),
    costUsd: result.costUsd,
  });
}
