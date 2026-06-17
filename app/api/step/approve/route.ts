import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { canTransition } from "@/lib/stepMachine";
import { STEP_ORDER, type StepKind } from "@/lib/types";

export const runtime = "nodejs";

// 단계 승인 — generated → approved. body: { projectId, step }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; step?: StepKind };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  const step = body.step;
  if (!projectId || !step || !STEP_ORDER.includes(step)) {
    return NextResponse.json({ ok: false, error: "projectId/step 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  const cur = project.steps[step];
  if (!canTransition(cur.status, "approved")) {
    return NextResponse.json(
      { ok: false, error: `${step}: ${cur.status} → approved 불가` },
      { status: 409 }
    );
  }

  cur.status = "approved";
  cur.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true });
}
