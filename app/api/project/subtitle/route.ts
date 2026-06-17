import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { DEFAULT_SUBTITLE, type SubtitleSettings } from "@/lib/types";

export const runtime = "nodejs";

const FONT = ["sans", "serif"];
const WEIGHT = ["regular", "bold"];
const SIZE = ["small", "medium", "large"];
const POS = ["bottom", "top"];
const ALIGN = ["center", "left"];
const BOX = ["dark", "light"];
const LANG = ["ko", "en", "both"];

// 자막 설정(일괄) 저장. body: { projectId, subtitle }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; subtitle?: Partial<SubtitleSettings> };
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

  const cur = project.subtitle ?? DEFAULT_SUBTITLE;
  const s = body.subtitle ?? {};
  // 허용값만 반영(나머지는 기존 유지).
  const next: SubtitleSettings = {
    font: FONT.includes(s.font as string) ? (s.font as "sans" | "serif") : cur.font,
    weight: WEIGHT.includes(s.weight as string)
      ? (s.weight as "regular" | "bold")
      : cur.weight,
    size: SIZE.includes(s.size as string)
      ? (s.size as "small" | "medium" | "large")
      : cur.size,
    position: POS.includes(s.position as string)
      ? (s.position as "bottom" | "top")
      : cur.position,
    align: ALIGN.includes(s.align as string)
      ? (s.align as "center" | "left")
      : cur.align,
    box: BOX.includes(s.box as string) ? (s.box as "dark" | "light") : cur.box,
    lang: LANG.includes(s.lang as string)
      ? (s.lang as "ko" | "en" | "both")
      : cur.lang,
  };

  project.subtitle = next;
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, subtitle: next });
}
