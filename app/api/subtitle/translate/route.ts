import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { translateNarrations } from "@/lib/translate";

export const runtime = "nodejs";
export const maxDuration = 60;

// 8. subtitle(번역) — 씬 나레이션 → 영문 자막 생성. body: { projectId }
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (project.scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "씬이 없어요 (스크립트 먼저)" }, { status: 422 });
  }

  try {
    const { translations } = await translateNarrations(
      projectId,
      project.scenes.map((s) => s.narration)
    );
    project.scenes = project.scenes.map((s, i) => ({
      ...s,
      narrationEn: translations[i] || s.narrationEn,
    }));
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({
      ok: true,
      scenes: project.scenes.map((s) => ({ index: s.index, narrationEn: s.narrationEn })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "번역 실패" },
      { status: 500 }
    );
  }
}
