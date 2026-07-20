import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { generateHostScript } from "@/lib/longformHost";
import { estimateDuration } from "@/lib/scenes";
import type { Scene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// 롱폼 진행자 대본 생성 — 세그먼트 스크립트를 읽어 오프닝·연결·마무리 나레이션을 만들고,
// 롱폼 scenes[] 에 호스트 씬(hostSlot)으로 저장한다. 이미지/영상/음성은 이후 단계.
//   POST { projectId }  → { ok, counts }
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
  const segIds = project.sourceProjectIds ?? [];
  if (segIds.length < 2) {
    return NextResponse.json({ ok: false, error: "세그먼트가 2개 이상이어야 해요" }, { status: 422 });
  }

  // 세그먼트별 합친 나레이션 수집(순서 유지).
  const segProjects = await getProjectsBulk(segIds);
  const byId = new Map(segProjects.map((s) => [s.id, s]));
  const segments = segIds
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({
      title: s.title,
      narration: (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" "),
    }));

  try {
    const { opening, connectors, closing } = await generateHostScript({ projectId, segments });

    // 호스트 씬 배열 구성 — 오프닝 → 연결(connectorAfter=i) → 마무리. index 는 순차.
    const scenes: Scene[] = [];
    let idx = 0;
    const mk = (narration: string, hostSlot: Scene["hostSlot"], connectorAfter?: number): Scene => ({
      index: idx++,
      narration,
      imagePrompt: "",
      motion: "",
      durationSec: estimateDuration(narration),
      status: "generated",
      hostSlot,
      ...(connectorAfter !== undefined ? { connectorAfter } : {}),
    });
    for (const t of opening) scenes.push(mk(t, "opening"));
    connectors.forEach((t, i) => scenes.push(mk(t, "connector", i)));
    for (const t of closing) scenes.push(mk(t, "closing"));

    // 저장 직전 fresh 재읽기 후 scenes/steps 만 머지(통째 저장 금지 규약).
    const fresh = (await getProject(projectId)) ?? project;
    fresh.scenes = scenes;
    fresh.steps.script.status = "approved";
    fresh.steps.script.updatedAt = Date.now();
    fresh.updatedAt = Date.now();
    await saveProject(fresh);

    return NextResponse.json({
      ok: true,
      counts: { opening: opening.length, connectors: connectors.length, closing: closing.length },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "진행자 대본 생성 실패" },
      { status: 500 }
    );
  }
}
