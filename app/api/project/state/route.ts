import { NextRequest, NextResponse } from "next/server";
import { getProject, deleteProject } from "@/lib/projectStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 프로젝트 전체 상태 조회 — 클라이언트가 (재방문/백그라운드 복귀/네트워크 복귀 시)
// 서버 진실로 복원(rehydrate)하는 데 사용. 자산 URL·단계 상태·finalVideoUrl 등 전부.
//   GET ?projectId  → { ok, project }
export async function GET(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, project });
}

// 프로젝트 삭제 — 라이브러리에서. DELETE ?projectId
export async function DELETE(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  await deleteProject(projectId);
  return NextResponse.json({ ok: true });
}
