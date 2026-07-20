import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk } from "@/lib/projectStore";
import { generateTitles } from "@/lib/titleGen";
import { saveTitleGenLog } from "@/lib/titleLog";

export const runtime = "nodejs";
export const maxDuration = 60;

// 롱폼 제목 자동 생성 — 세그먼트(챕터)들 + 오프닝을 모아 제목 6원칙으로 후보 생성.
//   POST { projectId }  → { ok, candidates, recommended_index, recommend_reason, seo_keywords }
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }

  const longform = await getProject(projectId);
  if (!longform) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  const segIds = longform.sourceProjectIds ?? [];
  if (segIds.length < 1) {
    return NextResponse.json({ ok: false, error: "세그먼트가 없어요" }, { status: 422 });
  }

  // 집계 대본 — 오프닝(있으면) + 챕터별 제목·요약.
  const segProjects = await getProjectsBulk(segIds);
  const byId = new Map(segProjects.map((s) => [s.id, s]));
  const parts: string[] = [];
  if (longform.opening?.script?.length) parts.push(`오프닝: ${longform.opening.script.join(" ")}`);
  segIds.forEach((id, i) => {
    const s = byId.get(id);
    if (!s) return;
    const summ = (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ").slice(0, 300);
    parts.push(`챕터 ${i + 1} [${s.title}]: ${summ}`);
  });
  const scriptText = parts.join("\n");
  if (scriptText.trim().length < 10) {
    return NextResponse.json({ ok: false, error: "세그먼트 대본이 비어 있어요" }, { status: 422 });
  }

  try {
    const result = await generateTitles({ projectId, scriptText });
    await saveTitleGenLog(projectId, result);
    return NextResponse.json({
      ok: true,
      candidates: result.candidates,
      recommended_index: result.recommended_index,
      recommend_reason: result.recommend_reason,
      seo_keywords: result.seo_keywords,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "제목 생성 실패" },
      { status: 500 }
    );
  }
}
