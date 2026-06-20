import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { translateNarrations } from "@/lib/translate";
import { getLang, dubNarration } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 60;

// 다국어판(번역) — 씬 나레이션 → 목표 언어 번역, scene.dub[lang].narration 에 저장.
// body: { projectId, lang? } (lang 미지정 시 영어, 하위호환)
export async function POST(req: NextRequest) {
  let body: { projectId?: string; lang?: string };
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

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (project.scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "씬이 없어요 (스크립트 먼저)" }, { status: 422 });
  }

  try {
    const { translations } = await translateNarrations(
      projectId,
      project.scenes.map((s) => s.narration),
      lang.english
    );
    project.scenes = project.scenes.map((s, i) => {
      const narration = translations[i] || dubNarration(s, lang.code);
      return { ...s, dub: { ...s.dub, [lang.code]: { ...s.dub?.[lang.code], narration } } };
    });
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({
      ok: true,
      lang: lang.code,
      scenes: project.scenes.map((s) => ({
        index: s.index,
        narration: dubNarration(s, lang.code),
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "번역 실패" },
      { status: 500 }
    );
  }
}
