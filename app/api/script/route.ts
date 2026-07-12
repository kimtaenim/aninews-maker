import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateScript, generateClicheScript } from "@/lib/script";
import { canStart } from "@/lib/stepMachine";
import type { SourceMaterial } from "@/lib/source";

export const runtime = "nodejs";
export const maxDuration = 60;

// 2. script — 소스에서 씬 배열 생성. body: { projectId, userPrompt? }
// 흐름: 프로젝트 로드 → source 승인 확인 → Claude → scenes[] 저장 →
// steps.script = generated.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; userPrompt?: string };
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
  if (!canStart(project, "script")) {
    return NextResponse.json(
      { ok: false, error: "소스 단계를 먼저 승인해주세요" },
      { status: 409 }
    );
  }

  const material = project.steps.source.params.material as SourceMaterial | undefined;
  if (!material?.body) {
    return NextResponse.json({ ok: false, error: "소스 본문 없음" }, { status: 422 });
  }

  const now = Date.now();
  project.steps.script.status = "generating";
  project.steps.script.updatedAt = now;
  await saveProject(project);

  try {
    // ani-cliché 모드는 로맨스 클리셰 생성기(대사+화자), 뉴스 모드는 기존 생성기.
    const { scenes } =
      project.mode === "cliche"
        ? await generateClicheScript({
            projectId,
            tropes: material.body.split(/[,·\n]/).map((t) => t.trim()).filter(Boolean),
            styleBible: project.styleBible,
            userPrompt: body.userPrompt ?? project.userPrompt,
            cast: project.cast,
          })
        : await generateScript({
            projectId,
            material,
            styleBible: project.styleBible,
            // 명시 userPrompt 우선, 없으면 소스 단계에서 저장한 프로젝트 의도 사용.
            userPrompt: body.userPrompt ?? project.userPrompt,
          });
    project.scenes = scenes;
    project.steps.script.status = "generated";
    project.steps.script.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: true, scenes });
  } catch (e) {
    const error = e instanceof Error ? e.message : "스크립트 생성 실패";
    project.steps.script.status = "error";
    project.steps.script.error = error;
    project.steps.script.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
