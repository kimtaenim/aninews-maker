import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import type { Watermark } from "@/lib/types";

export const runtime = "nodejs";

const POS = ["tl", "tr", "bl", "br"];

// 워터마크 저장. body: { projectId, watermark: { text, position } }
// text 가 비면 워터마크 제거.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; watermark?: Partial<Watermark> };
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

  const text = (body.watermark?.text ?? "").trim().slice(0, 60);
  const posIn = body.watermark?.position;
  if (!text) {
    project.watermark = undefined; // 비우면 제거
  } else {
    project.watermark = {
      text,
      position: POS.includes(posIn as string)
        ? (posIn as Watermark["position"])
        : project.watermark?.position ?? "br",
    };
  }
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, watermark: project.watermark ?? null });
}
