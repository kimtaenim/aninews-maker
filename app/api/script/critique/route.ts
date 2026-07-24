import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { critiqueScript } from "@/lib/scriptCritique";

export const runtime = "nodejs";
export const maxDuration = 300; // 웹 검색 여러 번 + 긴 리포트 — 넉넉히

// [2단계 대본] 비판 검수 — 웹 검색으로 반대편 사실을 찾아 2부 리포트를 낸다(자동 반영 없음).
// 리포트는 스크립트 대화 로그에 어시스턴트 메시지로 남긴다(표시·이력). 씬은 안 건드린다.
//   POST { projectId }  → { ok, report, searched, chat }
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  if (!project.scenes?.length) {
    return NextResponse.json({ ok: false, error: "대본이 아직 없어요 (먼저 생성)" }, { status: 422 });
  }

  // 그림 완성 여부 — 씬 이미지가 하나라도 있으면 완성으로 보고 그림 호환 판정을 켠다.
  const imagesReady = project.scenes.some((s) => !!s.imageUrl);

  try {
    const { report, searched } = await critiqueScript({
      projectId,
      narrations: project.scenes.map((s) => s.narration),
      imagesReady,
    });

    // 리포트를 스크립트 대화 로그에 남긴다(씬은 변경하지 않음). 저장 직전 fresh 재읽기.
    const fresh = (await getProject(projectId)) ?? project;
    const now = Date.now();
    const header = searched ? "🔎 비판 검수 (웹 검색 확인)" : "⚠️ 비판 검수 (웹 검색이 돌지 않음 — 검증 신뢰도 낮음)";
    fresh.steps.script.chat.push(
      { role: "user", text: "[비판 검수 실행]", ts: now },
      { role: "assistant", text: `${header}\n\n${report}`, ts: now }
    );
    fresh.steps.script.updatedAt = now;
    fresh.updatedAt = now;
    await saveProject(fresh);

    return NextResponse.json({ ok: true, report, searched, chat: fresh.steps.script.chat });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "비판 검수 실패" },
      { status: 500 }
    );
  }
}
