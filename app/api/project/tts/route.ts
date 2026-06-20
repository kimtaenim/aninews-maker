import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 보이스오버 엔진(프로젝트별) 저장. body: { projectId, provider: "elevenlabs"|"typecast" }
// env TTS_PROVIDER 는 기본값일 뿐, 여기서 고른 값이 우선한다(lib/tts resolveTtsProvider).
export async function POST(req: NextRequest) {
  let body: { projectId?: string; provider?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  if (body.provider !== "elevenlabs" && body.provider !== "typecast") {
    return NextResponse.json({ ok: false, error: "provider 는 elevenlabs|typecast" }, { status: 422 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  project.ttsProvider = body.provider;
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, provider: project.ttsProvider });
}
