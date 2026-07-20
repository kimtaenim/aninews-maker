import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { setTitleSelected } from "@/lib/titleLog";

export const runtime = "nodejs";

// 프로젝트 제목 변경. body: { projectId, title }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; title?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  const title = (body.title ?? "").trim().slice(0, 200);
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  if (!title) {
    return NextResponse.json({ ok: false, error: "제목을 입력해주세요" }, { status: 422 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  project.title = title;
  project.updatedAt = Date.now();
  await saveProject(project);
  // 제목 생성 로그가 있으면 최종 선택/수정 제목 기록(추후 성과 조인용). 없으면 조용히 통과.
  await setTitleSelected(projectId, title);
  return NextResponse.json({ ok: true, title });
}
