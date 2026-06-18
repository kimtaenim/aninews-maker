import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 음성(TTS) 전용 스크립트 직접 편집 저장. body: { projectId, scenes: [{index, ttsScript}] }
// 자막용 narration 은 건드리지 않고, 음성 합성에만 쓰는 ttsScript 오버라이드만 보존한다.
// 빈 문자열이면 오버라이드 해제(undefined) → 음성 합성 시 narration 으로 폴백
// (app/api/audio/scene 참고).
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    scenes?: Array<{ index?: number; ttsScript?: string }>;
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
    if (typeof e?.index === "number") byIndex.set(e.index, (e.ttsScript ?? "").trim());
  }
  project.scenes = project.scenes.map((s) =>
    byIndex.has(s.index) ? { ...s, ttsScript: byIndex.get(s.index) || undefined } : s
  );
  project.updatedAt = Date.now();
  await saveProject(project);

  return NextResponse.json({
    ok: true,
    scenes: project.scenes.map((s) => ({ index: s.index, ttsScript: s.ttsScript ?? "" })),
  });
}
