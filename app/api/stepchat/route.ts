import { NextResponse } from "next/server";

// StepChat — 단계별 미세조정. 사용자 요청 → Claude 의도해석 → params 패치 →
// (rerun 이면) 해당 단계 재호출. lib/stepChat.ts 의 runStepChat 사용.
// TODO: const result = await runStepChat(body); rerun 이면 해당 step API 트리거.
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
