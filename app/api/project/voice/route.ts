import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 보이스오버 목소리(프로젝트당 하나) 저장. body: { projectId, voiceId }
// voiceId 는 config/voices.json 의 voice id. 빈 값이면 해제(env 기본 목소리 사용).
// 음성 생성 시 lib/tts synthesize({ voiceId }) 로 전달된다.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; voiceId?: string };
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

  project.voiceId = (body.voiceId ?? "").trim() || undefined;
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, voiceId: project.voiceId ?? "" });
}
