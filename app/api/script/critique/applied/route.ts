import { NextRequest, NextResponse } from "next/server";
import { setCritiqueApplied } from "@/lib/scriptCritiqueLog";

export const runtime = "nodejs";

// 비판 검수 항목 중 실제로 반영한 것 기록 — 새로고침 후 같은 항목을 두 번 넣는 사고를 막는다.
// 실패해도 대본 반영 자체는 이미 끝난 뒤라 조용히 넘어간다(호출부도 결과를 안 기다림).
//   POST { projectId, ids: string[] }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; ids?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  const ids = Array.isArray(body.ids) ? body.ids.map((v) => String(v)) : [];
  if (!projectId || ids.length === 0) {
    return NextResponse.json({ ok: false, error: "projectId·ids 필요" }, { status: 400 });
  }
  await setCritiqueApplied(projectId, ids);
  return NextResponse.json({ ok: true });
}
