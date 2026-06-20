import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateKeyframes } from "@/lib/image";
import { canStart } from "@/lib/stepMachine";
import { formatKrw } from "@/lib/cost";
import type { ImageQuality } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120; // 이미지 생성은 수십 초 걸릴 수 있음

// 3. keyframe — 씬0 한 장으로 스타일·인물·팔레트 확정. 이후 전 씬의 레퍼런스.
// body: { projectId, quality? }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; quality?: ImageQuality };
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
  if (!canStart(project, "keyframe")) {
    return NextResponse.json(
      { ok: false, error: "스크립트 단계를 먼저 승인해주세요" },
      { status: 409 }
    );
  }
  const scene0 = project.scenes[0];
  if (!scene0?.imagePrompt) {
    return NextResponse.json(
      { ok: false, error: "씬0 이미지 프롬프트가 없어요" },
      { status: 422 }
    );
  }

  project.steps.keyframe.status = "generating";
  project.steps.keyframe.updatedAt = Date.now();
  await saveProject(project);

  try {
    // 후보 3장 생성. 빠름·저렴(low) 고정. 선택은 /select 에서.
    const { urls, costUsd } = await generateKeyframes({
      projectId,
      styleBible: project.styleBible,
      scenePrompt: scene0.imagePrompt,
      narration: scene0.narration,
      quality: body.quality ?? "low",
      count: 3,
      referenceImageUrl: project.keyframeReferenceUrl, // 업로드한 참조본이 있으면 img2img
    });
    project.steps.keyframe.params = {
      ...project.steps.keyframe.params,
      candidates: urls,
    };
    project.steps.keyframe.status = "generated";
    project.steps.keyframe.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: true, urls, cost: formatKrw(costUsd) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "키프레임 생성 실패";
    project.steps.keyframe.status = "error";
    project.steps.keyframe.error = error;
    project.steps.keyframe.updatedAt = Date.now();
    await saveProject(project);
    // Blob 토큰 누락 같은 설정 오류를 사용자에게 분명히.
    const hint = /token|blob/i.test(error)
      ? " (BLOB_READ_WRITE_TOKEN 이 .env.local 에 있는지 확인해주세요)"
      : "";
    return NextResponse.json({ ok: false, error: error + hint }, { status: 500 });
  }
}
