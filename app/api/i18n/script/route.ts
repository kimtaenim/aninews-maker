import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { getLang, dubNarration } from "@/lib/languages";

export const runtime = "nodejs";

// 다국어판 번역 스크립트 직접 편집 저장. scene.dub[lang].narration 에 보존만 한다.
// body: { projectId, lang?, scenes: [{index, narration}] }
//   (번역 생성은 /api/subtitle/translate. 여기선 사용자가 손본 번역을 저장.)
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    lang?: string;
    scenes?: Array<{ index?: number; narration?: string; narrationEn?: string }>;
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
  const lang = getLang(body.lang ?? "en");
  if (!lang) {
    return NextResponse.json({ ok: false, error: "지원하지 않는 언어" }, { status: 422 });
  }
  const edits = Array.isArray(body.scenes) ? body.scenes : [];

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  const byIndex = new Map<number, string>();
  for (const e of edits) {
    // narration 우선, 하위호환으로 narrationEn 도 받음.
    if (typeof e?.index === "number")
      byIndex.set(e.index, (e.narration ?? e.narrationEn ?? "").trim());
  }
  project.scenes = project.scenes.map((s) =>
    byIndex.has(s.index)
      ? { ...s, dub: { ...s.dub, [lang.code]: { ...s.dub?.[lang.code], narration: byIndex.get(s.index) } } }
      : s
  );
  project.updatedAt = Date.now();
  await saveProject(project);

  return NextResponse.json({
    ok: true,
    lang: lang.code,
    scenes: project.scenes.map((s) => ({ index: s.index, narration: dubNarration(s, lang.code) })),
  });
}
