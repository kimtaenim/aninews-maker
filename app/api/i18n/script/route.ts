import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 다국어판 영문 스크립트 직접 편집 저장. body: { projectId, scenes: [{index, narrationEn}] }
// (번역 생성은 /api/subtitle/translate. 여기선 사용자가 손본 영문을 보존만 한다.)
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    scenes?: Array<{ index?: number; narrationEn?: string }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const edits = Array.isArray(body.scenes) ? body.scenes : [];

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  const byIndex = new Map<number, string>();
  for (const e of edits) {
    if (typeof e?.index === "number") byIndex.set(e.index, (e.narrationEn ?? "").trim());
  }
  project.scenes = project.scenes.map((s) =>
    byIndex.has(s.index) ? { ...s, narrationEn: byIndex.get(s.index) } : s
  );
  project.updatedAt = Date.now();
  await saveProject(project);

  return NextResponse.json({
    ok: true,
    scenes: project.scenes.map((s) => ({ index: s.index, narrationEn: s.narrationEn })),
  });
}
