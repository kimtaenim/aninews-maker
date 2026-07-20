import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { generateOpening } from "@/lib/openingGen";
import { saveOpeningLog, setOpeningFinal } from "@/lib/openingLog";
import type { LongformOpening } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// 롱폼 오프닝(열린 고리) — 세그먼트를 챕터로 읽어 오프닝 스크립트 + 고리 명세 + 챕터 가이드 생성.
//   POST { projectId }                 → 생성(project.opening 저장 + 로그) → { ok, opening }
//   POST { projectId, script: [...] }  → 사용자가 수정한 오프닝 저장(재생성 없음) → { ok, opening }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; script?: unknown };
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

  // 저장 모드 — 수정한 script 만 반영(재생성 없음).
  if (Array.isArray(body.script)) {
    const script = body.script.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => s.trim());
    if (!longform.opening) {
      return NextResponse.json({ ok: false, error: "먼저 오프닝을 생성해주세요" }, { status: 422 });
    }
    const fresh = (await getProject(projectId)) ?? longform;
    fresh.opening = { ...(fresh.opening as LongformOpening), script, generatedAt: Date.now() };
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    await setOpeningFinal(projectId, script);
    return NextResponse.json({ ok: true, opening: fresh.opening });
  }

  const segIds = longform.sourceProjectIds ?? [];
  if (segIds.length < 2) {
    return NextResponse.json({ ok: false, error: "세그먼트가 2개 이상이어야 해요" }, { status: 422 });
  }

  // 챕터 = 세그먼트(제목 + 핵심 요약). 요약은 각 세그먼트 나레이션 앞부분.
  const segProjects = await getProjectsBulk(segIds);
  const byId = new Map(segProjects.map((s) => [s.id, s]));
  const chapters = segIds
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({
      title: s.title,
      summary: (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ").slice(0, 400),
    }));
  const topic = longform.title;

  try {
    const result = await generateOpening({ projectId, topic, chapters });
    const opening: LongformOpening = {
      script: result.script,
      openLoop: result.openLoop,
      chapterBridges: result.chapterBridges,
      selfCheck: result.selfCheck,
      generatedAt: Date.now(),
    };
    const fresh = (await getProject(projectId)) ?? longform;
    fresh.opening = opening;
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    await saveOpeningLog(projectId, topic, chapters, result);
    return NextResponse.json({ ok: true, opening, violations: result.violations });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "오프닝 생성 실패" },
      { status: 500 }
    );
  }
}
