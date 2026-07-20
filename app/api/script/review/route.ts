import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { reviewScript } from "@/lib/scriptReview";
import { saveReviewLog, setReviewOutcome } from "@/lib/scriptReviewLog";

export const runtime = "nodejs";
export const maxDuration = 60;

// 대본 구조 검수(열린 고리) — 스크립트 확정 전 호출. 위반 시 진단+수정안 반환(원문은 안 바꿈).
//   POST { projectId }             → 검수 → { ok, review }
//   POST { projectId, outcome }    → 동의/채택 결과 로깅(원문 변경은 클라이언트가 별도로)
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    outcome?: { consented: boolean; adopted?: "all" | "partial" | "manual" | "none"; finalNarrations?: string[] };
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

  // 결과 로깅 모드(동의 여부·채택본).
  if (body.outcome) {
    await setReviewOutcome(projectId, body.outcome);
    return NextResponse.json({ ok: true });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  const narrations = (project.scenes ?? []).filter((s) => !s.skipped).map((s) => s.narration ?? "");
  if (narrations.filter((n) => n.trim().length > 1).length < 3) {
    return NextResponse.json({ ok: false, error: "대본이 짧아요 (먼저 스크립트를 만들어주세요)" }, { status: 422 });
  }

  try {
    const review = await reviewScript({ projectId, narrations });
    await saveReviewLog(projectId, review);
    return NextResponse.json({ ok: true, review });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "대본 검수 실패" },
      { status: 500 }
    );
  }
}
