import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { generateTitles, scriptToText } from "@/lib/titleGen";
import { saveTitleGenLog } from "@/lib/titleLog";

export const runtime = "nodejs";
export const maxDuration = 60;

// 제목 자동 생성 — 확정 대본으로 제목 후보 3개 + 추천 + SEO 키워드. 스크립트 확정 직후 호출.
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

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // 확정 대본 — 건너뛴 씬·구독 유도(마무리) 씬은 제외하고 본문만.
  const narrations = (project.scenes ?? [])
    .filter((s) => !s.skipped && !/구독|좋아요/.test(s.narration ?? ""))
    .map((s) => s.narration ?? "");
  const scriptText = scriptToText(narrations);
  if (scriptText.trim().length < 10) {
    return NextResponse.json({ ok: false, error: "대본이 비어 있어요 (먼저 스크립트를 만들어주세요)" }, { status: 422 });
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
