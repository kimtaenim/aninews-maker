import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { generateMotions, type SceneInput } from "@/lib/sceneFill";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 60;

// 5단계 — 씬별 영문 모션 프롬프트 생성. 저장은 안 하고 값만 반환.
// body: { projectId, scenes: [{ index, narration }] }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; scenes?: SceneInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const scenes = (Array.isArray(body.scenes) ? body.scenes : [])
    .filter((s) => typeof s?.index === "number" && s?.narration?.trim())
    .slice(0, 30);
  if (scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "나레이션이 있는 씬이 없어요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  try {
    const { motions, costUsd } = await generateMotions({ projectId, scenes });
    return NextResponse.json({
      ok: true,
      motions: scenes
        .map((s) => ({ index: s.index, motion: motions.get(s.index) ?? "" }))
        .filter((m) => m.motion),
      cost: formatKrw(costUsd),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "모션 생성 실패" },
      { status: 500 }
    );
  }
}
