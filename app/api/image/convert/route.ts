import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { convertToRealistic } from "@/lib/image";
import { formatKrw } from "@/lib/cost";
import type { ImageQuality } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120; // 이미지 변환은 수십 초

// 이미 만든 그림을 실사(사진·영화)로 변환(img2img — 구도 유지, 화풍만 실사).
// body: { projectId, sceneIndex, quality? }  (sceneIndex 0 = 키프레임)
export async function POST(req: NextRequest) {
  let body: { projectId?: string; sceneIndex?: number; quality?: ImageQuality };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const sceneIndex = body.sceneIndex;
  if (typeof sceneIndex !== "number" || !Number.isInteger(sceneIndex) || sceneIndex < 0) {
    return NextResponse.json({ ok: false, error: "sceneIndex 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // sceneIndex 0 = 키프레임, 그 외 = 씬 이미지.
  const isKeyframe = sceneIndex === 0;
  const scene = isKeyframe ? undefined : project.scenes[sceneIndex];
  const srcUrl = isKeyframe ? project.keyframeUrl : scene?.imageUrl;
  if (!isKeyframe && (sceneIndex >= project.scenes.length || !scene)) {
    return NextResponse.json({ ok: false, error: "sceneIndex 범위 밖" }, { status: 422 });
  }
  if (!srcUrl) {
    return NextResponse.json(
      { ok: false, error: isKeyframe ? "키프레임 이미지가 없어요" : `씬${sceneIndex + 1} 이미지가 없어요` },
      { status: 422 }
    );
  }

  try {
    const { url, costUsd } = await convertToRealistic({
      projectId,
      imageUrl: srcUrl,
      narration: scene?.narration,
      label: isKeyframe ? "keyframe" : `scene-${sceneIndex}`,
      quality: body.quality,
      subtitlePosition: project.subtitle?.position,
    });

    // 무거운 생성 뒤 최신 상태 재읽기(다른 씬 동시 저장 덮어쓰기 방지).
    const fresh = (await getProject(projectId)) ?? project;
    if (isKeyframe) {
      fresh.keyframeUrl = url;
    } else {
      const fScene = fresh.scenes[sceneIndex] ?? scene!;
      fresh.scenes[sceneIndex] = { ...fScene, imageUrl: url, status: "generated" };
    }
    fresh.updatedAt = Date.now();
    await saveProject(fresh);

    return NextResponse.json({ ok: true, url, sceneIndex, cost: formatKrw(costUsd) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "실사 변환 실패";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
