import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 롱폼 세그먼트 순서 변경 — order 는 기존 sourceProjectIds 의 재배열(같은 집합)이어야 한다.
//   POST { projectId, order: string[] }  → { ok }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; order?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const order = Array.isArray(body.order)
    ? body.order.filter((x): x is string => typeof x === "string")
    : [];

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  const current = project.sourceProjectIds ?? [];
  // 검증 — 같은 집합의 재배열이어야 함(길이 같고, 원소 동일).
  const same =
    order.length === current.length &&
    [...order].sort().join("|") === [...current].sort().join("|");
  if (!same) {
    return NextResponse.json({ ok: false, error: "순서 목록이 세그먼트와 일치하지 않아요" }, { status: 422 });
  }

  // 저장 직전 fresh 재읽기 후 sourceProjectIds 만 머지.
  const fresh = (await getProject(projectId)) ?? project;
  fresh.sourceProjectIds = order;
  fresh.updatedAt = Date.now();
  await saveProject(fresh);
  return NextResponse.json({ ok: true });
}
