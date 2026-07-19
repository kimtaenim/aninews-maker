import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateScene } from "@/lib/image";
import { formatDims } from "@/lib/format";
import { canStart } from "@/lib/stepMachine";
import { formatKrw } from "@/lib/cost";
import type { ImageQuality } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 120; // 이미지 생성은 수십 초 걸릴 수 있음

// 4. images — 씬별 이미지(키프레임 레퍼런스). 한 번에 한 씬(리롤 1장)을 생성한다.
// 씬0 은 키프레임 단계 산출물이라 여기선 씬1 이상만 다룬다.
// body: { projectId, sceneIndex, quality? }
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
  if (typeof sceneIndex !== "number" || !Number.isInteger(sceneIndex)) {
    return NextResponse.json({ ok: false, error: "sceneIndex 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (!canStart(project, "images")) {
    return NextResponse.json(
      { ok: false, error: "키프레임 단계를 먼저 승인해주세요" },
      { status: 409 }
    );
  }
  if (!project.keyframeUrl) {
    return NextResponse.json(
      { ok: false, error: "키프레임이 없어요 (3단계 먼저)" },
      { status: 409 }
    );
  }
  if (sceneIndex < 1 || sceneIndex >= project.scenes.length) {
    return NextResponse.json(
      { ok: false, error: "씬1 이후만 생성합니다 (씬0=키프레임)" },
      { status: 422 }
    );
  }
  const scene = project.scenes[sceneIndex];
  // upload 모드는 사용자가 직접 넣은 이미지를 쓰므로 생성 대상이 아님(클라이언트가 차단하지만 방어).
  if (scene?.imageSource === "upload") {
    return NextResponse.json(
      { ok: false, error: "업로드 모드 씬은 이미지를 생성하지 않아요" },
      { status: 422 }
    );
  }
  if (!scene?.imagePrompt) {
    return NextResponse.json(
      { ok: false, error: `씬${sceneIndex + 1} 이미지 프롬프트가 없어요` },
      { status: 422 }
    );
  }
  // reference 모드는 참조 이미지가 반드시 있어야 함.
  if (scene.imageSource === "reference" && !scene.referenceImageUrl) {
    return NextResponse.json(
      { ok: false, error: `씬${sceneIndex + 1} 참조 이미지를 먼저 업로드해주세요` },
      { status: 422 }
    );
  }

  if (scene.skipped) {
    return NextResponse.json({ ok: false, error: "건너뛴 씬이에요" }, { status: 422 });
  }

  project.steps.images.status = "generating";
  project.steps.images.updatedAt = Date.now();
  project.scenes[sceneIndex] = { ...scene, status: "generating" };
  await saveProject(project);

  try {
    const { url, costUsd } = await generateScene({
      projectId,
      imageSize: formatDims(project.format).imageSize, // 가로 롱폼이면 16:9로
      styleBible: project.styleBible,
      scenePrompt: scene.imagePrompt,
      narration: scene.narration,
      sceneIndex,
      keyframeUrl: project.keyframeUrl,
      quality: body.quality,
      referenceImageUrl:
        scene.imageSource === "reference" ? scene.referenceImageUrl : undefined,
      // [cliche] 캐스팅 포트레이트 — 등장인물 외모를 시트로 고정(키프레임과 함께 참조).
      portraitUrls: project.castMembers
        ?.map((m) => m.portraitUrl)
        .filter((u): u is string => !!u),
      paletteHint: scene.paletteHint,
      subtitlePosition: project.subtitle?.position, // 비워둘 지점(자막 위치) 반영
    });

    // 무거운 생성(수십 초) 뒤 — 다른 씬의 동시 저장을 덮어쓰지 않도록 최신 상태 재읽기.
    const fresh = (await getProject(projectId)) ?? project;
    const freshScene = fresh.scenes[sceneIndex] ?? scene;
    fresh.scenes[sceneIndex] = { ...freshScene, imageUrl: url, status: "generated" };

    // 씬0 은 keyframe 단계 산출물 → 이미지 단계 완료는 씬1 이후 기준(클라이언트와 일치).
    const allDone =
      fresh.scenes.length > 1 && fresh.scenes.slice(1).every((s) => s.skipped || !!s.imageUrl);
    fresh.steps.images.status = allDone ? "generated" : "generating";
    fresh.steps.images.updatedAt = Date.now();
    fresh.updatedAt = Date.now();
    await saveProject(fresh);

    return NextResponse.json({
      ok: true,
      url,
      sceneIndex,
      allDone,
      cost: formatKrw(costUsd),
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "이미지 생성 실패";
    // 생성 시도(수십 초) 동안 다른 저장이 있었을 수 있으니 최신 재읽기 후 머지.
    const fresh = (await getProject(projectId)) ?? project;
    fresh.steps.images.status = "error";
    fresh.steps.images.error = error;
    fresh.steps.images.updatedAt = Date.now();
    fresh.scenes[sceneIndex] = { ...(fresh.scenes[sceneIndex] ?? scene), status: "error" };
    await saveProject(fresh);
    const hint = /token|blob/i.test(error)
      ? " (BLOB_READ_WRITE_TOKEN 이 .env.local 에 있는지 확인해주세요)"
      : "";
    return NextResponse.json({ ok: false, error: error + hint }, { status: 500 });
  }
}
