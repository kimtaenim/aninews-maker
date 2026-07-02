import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateImagePrompts, type SceneInput } from "@/lib/sceneFill";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 60;

// 3·4단계 — 씬별 한글 이미지 프롬프트 생성·저장(모드=styleBible 반영). 편집 저장
// (/api/script/scenes)과 달리 단계 상태(script approved 등)는 건드리지 않는다 —
// 승인 후 프롬프트 생성해도 승인이 풀리지 않게. body: { projectId, scenes: [{index, narration}] }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; scenes?: SceneInput[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const scenes = (Array.isArray(body.scenes) ? body.scenes : [])
    .filter((s) => typeof s?.index === "number" && s?.narration?.trim())
    .slice(0, 30);
  if (scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "나레이션이 있는 씬이 없어요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  try {
    const { prompts, costUsd, raw } = await generateImagePrompts({
      projectId,
      scenes,
      styleBible: project.styleBible,
    });
    if (prompts.size === 0) {
      const snippet = (raw || "(모델이 빈 응답을 보냈어요)").replace(/\s+/g, " ").slice(0, 200);
      return NextResponse.json(
        { ok: false, error: `프롬프트 생성 결과가 비었어요 — 다시 시도. [모델응답: ${snippet}]` },
        { status: 502 }
      );
    }
    // 생성된 프롬프트 + 보낸 나레이션을 해당 씬에 저장(나머지 필드·단계 상태 보존).
    const narrMap = new Map(scenes.map((s) => [s.index, s.narration.trim()]));
    project.scenes = project.scenes.map((sc) => {
      const prompt = prompts.get(sc.index);
      if (prompt === undefined) return sc;
      const narration = narrMap.get(sc.index);
      return { ...sc, imagePrompt: prompt, ...(narration ? { narration } : {}) };
    });
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({
      ok: true,
      scenes: project.scenes,
      cost: formatKrw(costUsd),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "프롬프트 생성 실패" },
      { status: 500 }
    );
  }
}
