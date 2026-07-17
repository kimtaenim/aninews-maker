import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 씬 순서 변경 — 서버의 project.scenes 를 씬 "객체 통째로" 옮긴다. body: { projectId, from, to }
// 배열 원소를 옮기므로 그 씬의 산출물(imageUrl/videoUrl/audioUrl/motion/prompt/자막 등)이
// 전부 함께 따라가고 index 만 재부여된다 → 어느 단계에서 재정렬해도 모든 단계가 같이 싱크됨.
// (기존 버그: 클라 자동저장이 나레이션 버퍼만 보내고 라우트가 옛 순서에서 index 로 산출물을
//  carry 해 이미지·영상·음성이 제자리에 남던 문제를 없앤다.)
export async function POST(req: NextRequest) {
  let body: { projectId?: string; from?: number; to?: number };
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
  const n = Array.isArray(project.scenes) ? project.scenes.length : 0;
  if (n === 0) {
    return NextResponse.json({ ok: false, error: "씬이 아직 없어요" }, { status: 409 });
  }

  const from = Math.floor(Number(body.from));
  const to = Math.floor(Number(body.to));
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= n || to < 0 || to >= n) {
    return NextResponse.json({ ok: false, error: "from/to 범위 밖" }, { status: 422 });
  }
  if (from === to) {
    return NextResponse.json({ ok: true, scenes: project.scenes }); // 변화 없음
  }

  const [moved] = project.scenes.splice(from, 1);
  project.scenes.splice(to, 0, moved);
  project.scenes = project.scenes.map((s, i) => ({ ...s, index: i }));
  project.steps.script.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);

  return NextResponse.json({ ok: true, scenes: project.scenes });
}
