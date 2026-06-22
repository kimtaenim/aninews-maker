import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 보이스오버 속도(프로젝트별) 저장. body: { projectId, speed: 1.0 | 1.2 }
// 음성 생성 시 엔진 속도 파라미터로 적용된다(lib/tts synthesize → speed).
export async function POST(req: NextRequest) {
  let body: { projectId?: string; speed?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const speed = Number(body.speed);
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2.0) {
    return NextResponse.json({ ok: false, error: "speed 는 0.5~2.0" }, { status: 422 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  project.voiceSpeed = speed;
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, speed: project.voiceSpeed });
}
