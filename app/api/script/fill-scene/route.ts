import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { fillSceneFromNarration } from "@/lib/sceneFill";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 30;

// 2. script (씬 자동 채우기) — 나레이션 한 줄 → image_prompt · motion · 길이(초).
// 새 씬을 추가할 때 클라이언트가 호출. 저장은 별도(편집 저장/승인)에서.
// body: { projectId, narration }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; narration?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const narration = (body.narration ?? "").trim();
  if (!narration) {
    return NextResponse.json({ ok: false, error: "나레이션을 입력해주세요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  try {
    const { imagePrompt, motion, durationSec, costUsd } = await fillSceneFromNarration({
      projectId,
      narration,
      styleBible: project.styleBible,
    });
    return NextResponse.json({
      ok: true,
      imagePrompt,
      motion,
      durationSec,
      cost: formatKrw(costUsd),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "씬 생성 실패" },
      { status: 500 }
    );
  }
}
