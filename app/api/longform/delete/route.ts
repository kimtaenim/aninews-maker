import { NextRequest, NextResponse } from "next/server";
import { getProject, deleteProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 롱폼 통째 삭제 — 롱폼 + 그 세그먼트들 + 진행자 프로젝트를 모두 지운다(Blob 포함).
// 세그먼트/진행자만 따로 지우려면 라이브러리 카드의 개별 삭제(✕)를 쓴다.
//   POST { projectId }  → { ok, deleted }
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

  // 삭제 대상 — 세그먼트 + 진행자 + 롱폼 자신. 중복 제거.
  const ids = [
    ...(longform.sourceProjectIds ?? []),
    ...(longform.hostProjectId ? [longform.hostProjectId] : []),
    projectId,
  ];
  const unique = [...new Set(ids.filter(Boolean))];

  let deleted = 0;
  for (const id of unique) {
    try {
      await deleteProject(id);
      deleted++;
    } catch {
      /* 개별 삭제 실패는 건너뛰고 계속(최대한 정리) */
    }
  }
  return NextResponse.json({ ok: true, deleted });
}
