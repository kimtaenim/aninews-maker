import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import {
  submitVideo,
  pollVideoJob,
  videoCostUsd,
  videoVendor,
  DEFAULT_VIDEO_MODEL_ID,
} from "@/lib/videoProvider";
import { canStart } from "@/lib/stepMachine";
import { uploadAsset } from "@/lib/blob";
import { formatKrw, recordCost } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 120; // 완료 폴링 시 비디오 다운로드+Blob 업로드

const VIDEO_FETCH_TIMEOUT_MS = 60_000;

// 5. videos — 씬 이미지 → fal image-to-video. 분 단위 비동기라 submit/poll 분리.
//   POST  { projectId, sceneIndex, prompt? }  → 제출 → { jobId }
//   GET   ?projectId&sceneIndex                → 폴링 → { status, videoUrl?, cost?, allDone? }
// 서버리스 타임아웃 회피: 각 호출은 짧게(제출/상태). 완료까지의 반복 폴링은 클라이언트.
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    sceneIndex?: number;
    prompt?: string;
    videoModelId?: string;
    motionScale?: "subtle" | "large";
  };
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
  if (!canStart(project, "videos")) {
    return NextResponse.json(
      { ok: false, error: "이미지 단계를 먼저 승인해주세요" },
      { status: 409 }
    );
  }
  if (sceneIndex < 0 || sceneIndex >= project.scenes.length) {
    return NextResponse.json({ ok: false, error: "sceneIndex 범위 밖" }, { status: 422 });
  }
  const scene = project.scenes[sceneIndex];
  if (!scene?.imageUrl) {
    return NextResponse.json(
      { ok: false, error: `씬${sceneIndex + 1} 이미지가 없어요` },
      { status: 422 }
    );
  }

  const modelId =
    body.videoModelId || project.videoModelId || DEFAULT_VIDEO_MODEL_ID;
  try {
    // 기본은 잔잔. 씬별로 "크게" 선택하면 더 역동적으로.
    const motion = (body.prompt ?? scene.motion ?? "").trim();
    const SUBTLE =
      "Keep motion subtle and minimal — small, gentle movements only; no large, fast, or dramatic action; slow steady camera.";
    const LARGE =
      "Use larger, more dynamic motion and noticeable camera movement, while keeping it coherent (not chaotic).";
    const guidance = body.motionScale === "large" ? LARGE : SUBTLE;
    const prompt = motion ? `${motion}. ${guidance}` : guidance;
    const { jobId } = await submitVideo(modelId, {
      imageUrl: scene.imageUrl,
      prompt,
    });
    project.scenes[sceneIndex] = {
      ...scene,
      videoJobId: jobId,
      videoModelId: modelId,
      videoUrl: undefined,
      status: "generating",
    };
    project.steps.videos.status = "generating";
    project.steps.videos.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: true, jobId });
  } catch (e) {
    const error = e instanceof Error ? e.message : "비디오 제출 실패";
    project.steps.videos.status = "error";
    project.steps.videos.error = error;
    project.steps.videos.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  const sceneIndexRaw = req.nextUrl.searchParams.get("sceneIndex");
  const sceneIndex = Number(sceneIndexRaw);
  if (!projectId || sceneIndexRaw === null || !Number.isInteger(sceneIndex)) {
    return NextResponse.json(
      { ok: false, error: "projectId/sceneIndex 필요" },
      { status: 400 }
    );
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (sceneIndex < 0 || sceneIndex >= project.scenes.length) {
    return NextResponse.json({ ok: false, error: "sceneIndex 범위 밖" }, { status: 422 });
  }
  const scene = project.scenes[sceneIndex];

  const modelId = scene.videoModelId || project.videoModelId || DEFAULT_VIDEO_MODEL_ID;
  const cost = formatKrw(videoCostUsd(modelId));

  // 이미 완료(Blob 저장 끝) → 그대로 반환(idempotent).
  if (scene.videoUrl) {
    const allDone = project.scenes.every((s) => !!s.videoUrl);
    return NextResponse.json({
      ok: true,
      status: "completed",
      videoUrl: scene.videoUrl,
      cost,
      allDone,
    });
  }
  if (!scene.videoJobId) {
    return NextResponse.json(
      { ok: false, error: "제출된 비디오 작업이 없어요 (먼저 생성)" },
      { status: 409 }
    );
  }

  const poll = await pollVideoJob(scene.videoJobId);

  if (poll.status === "failed") {
    project.scenes[sceneIndex] = { ...scene, status: "error" };
    project.steps.videos.status = "error";
    project.steps.videos.error = poll.error;
    project.steps.videos.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: true, status: "failed", error: poll.error });
  }

  if (poll.status !== "completed") {
    // pending / running
    return NextResponse.json({ ok: true, status: poll.status });
  }

  // completed — fal 임시 URL → Blob 로 영구 저장.
  let videoUrl: string;
  try {
    const r = await fetch(poll.videoUrl, {
      signal: AbortSignal.timeout(VIDEO_FETCH_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`비디오 다운로드 실패 (HTTP ${r.status})`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const up = await uploadAsset(
      `project/${projectId}/scene-${sceneIndex}-${Date.now()}.mp4`,
      bytes,
      "video/mp4"
    );
    videoUrl = up.url;
  } catch (e) {
    const error = e instanceof Error ? e.message : "비디오 저장 실패";
    project.steps.videos.status = "error";
    project.steps.videos.error = error;
    project.steps.videos.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: true, status: "failed", error });
  }

  project.scenes[sceneIndex] = { ...scene, videoUrl, status: "generated" };
  const allDone = project.scenes.every((s) => !!s.videoUrl);
  project.steps.videos.status = allDone ? "generated" : "generating";
  project.steps.videos.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);

  // 완료 시 1회만 비용 기록(다음 폴링은 위 videoUrl 분기에서 조기 반환).
  await recordCost({
    projectId,
    vendor: videoVendor(modelId),
    model: modelId,
    costUsd: videoCostUsd(modelId),
    meta: { kind: "video", sceneIndex },
  });

  return NextResponse.json({ ok: true, status: "completed", videoUrl, cost, allDone });
}
