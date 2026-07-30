import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { runFactCheck } from "@/lib/elongatedFactCheck";
import { scoreElongated } from "@/lib/elongatedScore";

export const runtime = "nodejs";
export const maxDuration = 120;

// [확장판 ⑤] 팩트 대조 · 닫힌 채점표.
//   POST { projectId, mode: "fact" | "score" }
//     fact  — 본문의 숫자·고유명사를 카드와 기계 대조(모델 안 씀, 무료)
//     score — 채점표 7항목(6항목 코드 + 열린 고리 1항목만 모델)
//   → { ok, factCheck? , score? }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  const mode = body.mode === "score" ? "score" : "fact";
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const project = await getProject(projectId);
  const track = project?.elongated;
  const plan = track?.plan;
  if (!project || !track || !plan) {
    return NextResponse.json({ ok: false, error: "설계가 아직 없어요" }, { status: 404 });
  }
  if (!plan.chapters.some((c) => (c.body ?? "").trim())) {
    return NextResponse.json({ ok: false, error: "본문이 아직 없어요" }, { status: 422 });
  }

  const source = await getProject(track.sourceProjectId);
  const sourceScenes = (source?.scenes ?? []).filter((s) => !s.skipped).map((s) => s.narration ?? "");

  try {
    const now = Date.now();
    if (mode === "fact") {
      const items = runFactCheck({ chapters: plan.chapters, facts: track.facts, sourceScenes });
      const factCheck = { items, checkedAt: now };
      const fresh = (await getProject(projectId)) ?? project;
      if (fresh.elongated) {
        await saveProject({
          ...fresh,
          elongated: { ...fresh.elongated, factCheck, updatedAt: now },
          updatedAt: now,
        });
      }
      return NextResponse.json({ ok: true, factCheck });
    }

    const score = await scoreElongated({
      projectId,
      input: { plan, facts: track.facts, sourceScenes, targetSec: track.targetSec },
    });
    // 채점이 수십 초 걸린다 — 저장 직전 fresh 재읽기.
    const fresh = (await getProject(projectId)) ?? project;
    if (fresh.elongated) {
      await saveProject({
        ...fresh,
        elongated: { ...fresh.elongated, score, updatedAt: Date.now() },
        updatedAt: Date.now(),
      });
    }
    return NextResponse.json({ ok: true, score });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "검수 실패" },
      { status: 500 }
    );
  }
}
