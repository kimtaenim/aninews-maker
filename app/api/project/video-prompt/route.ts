import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 5단계 영상 생성 공통 프롬프트(프로젝트별) 저장. body: { projectId, prompt }
// 전 씬 영상 생성 시 씬 motion 뒤에 공통으로 덧붙는다(app/api/video/scene). 빈 문자열=지움.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; prompt?: string };
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

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  project.videoCommonPrompt = prompt || undefined;
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, videoCommonPrompt: project.videoCommonPrompt ?? "" });
}
