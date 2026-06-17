import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 키프레임 후보 3장 중 하나 선택 → 그게 씬0 이미지 + 전 씬 레퍼런스가 된다.
// body: { projectId, url }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  const url = (body.url ?? "").trim();
  if (!projectId || !url) {
    return NextResponse.json({ ok: false, error: "projectId/url 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  const candidates = (project.steps.keyframe.params.candidates as string[]) ?? [];
  if (!candidates.includes(url)) {
    return NextResponse.json(
      { ok: false, error: "후보 목록에 없는 이미지예요" },
      { status: 422 }
    );
  }

  const scene0 = project.scenes[0];
  project.keyframeUrl = url;
  if (scene0) {
    project.scenes[0] = { ...scene0, imageUrl: url, status: "generated" };
  }
  project.steps.keyframe.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);

  return NextResponse.json({ ok: true, url });
}
