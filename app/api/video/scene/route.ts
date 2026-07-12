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
import { getVideoMotion } from "@/lib/prompts";
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
  if (scene?.skipped) {
    return NextResponse.json({ ok: false, error: "건너뛴 씬이에요" }, { status: 422 });
  }
  if (scene?.videoSource === "upload") {
    return NextResponse.json(
      { ok: false, error: "업로드 모드 씬은 영상을 생성하지 않아요" },
      { status: 422 }
    );
  }
  if (!scene?.imageUrl) {
    return NextResponse.json(
      { ok: false, error: `씬${sceneIndex + 1} 이미지가 없어요` },
      { status: 422 }
    );
  }

  const modelId =
    body.videoModelId || project.videoModelId || DEFAULT_VIDEO_MODEL_ID;
  try {
    // 기본은 잔잔(동작 적게 + 스톱모션 느낌). 씬별로 "크게" 선택하면 더 역동적으로.
    // 가이드 문구는 config/prompts.json 의 video_motion 에서 관리(하드코딩 X).
    const motion = (body.prompt ?? scene.motion ?? "").trim();
    // 씬별로 subtle/large 선택 유지. 클리셰에서 "크게"=다이내믹 MV, "잔잔"=차분하되 글로시한
    // MV 비트(cliche_calm — 뉴스용 스톱모션 잔잔과 다름). 미지정 기본값: 뉴스=잔잔(subtle),
    // 클리셰=MV(cliche) — 클리셰가 잔잔·스톱모션 톤으로 생성되던 원인(기본 subtle)을 방어.
    const isCliche = project.mode === "cliche";
    const scale =
      body.motionScale === "large"
        ? isCliche
          ? "cliche"
          : "large"
        : body.motionScale === "subtle"
          ? isCliche
            ? "cliche_calm"
            : "subtle"
          : isCliche
            ? "cliche"
            : "subtle";
    const guidance = getVideoMotion(scale);
    const prompt = motion ? `${motion}. ${guidance}` : guidance;
    const { jobId } = await submitVideo(modelId, {
      imageUrl: scene.imageUrl,
      prompt,
    });
    // 제출(네트워크 수 초) 동안 다른 저장(효과음·자막 등)이 있었을 수 있으니
    // 최신 재읽기 후 이 씬의 비디오 필드만 머지(낡은 스냅샷 통째 저장 금지).
    const fresh = (await getProject(projectId)) ?? project;
    fresh.scenes[sceneIndex] = {
      ...(fresh.scenes[sceneIndex] ?? scene),
      videoJobId: jobId,
      videoModelId: modelId,
      videoUrl: undefined,
      status: "generating",
    };
    fresh.steps.videos.status = "generating";
    fresh.steps.videos.updatedAt = Date.now();
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, jobId });
  } catch (e) {
    const error = e instanceof Error ? e.message : "비디오 제출 실패";
    const fresh = (await getProject(projectId)) ?? project;
    fresh.steps.videos.status = "error";
    fresh.steps.videos.error = error;
    fresh.steps.videos.updatedAt = Date.now();
    await saveProject(fresh);
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
    // 씬0 은 keyframe 앵커라 videos 완료 판정에서 제외(이미지 단계와 동일 정책).
    const allDone = project.scenes.slice(1).every((s) => s.skipped || !!s.videoUrl);
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
    // 폴링(네트워크) 동안 다른 저장이 있었을 수 있으니 최신 재읽기 후 머지.
    const fresh = (await getProject(projectId)) ?? project;
    fresh.scenes[sceneIndex] = { ...(fresh.scenes[sceneIndex] ?? scene), status: "error" };
    fresh.steps.videos.status = "error";
    fresh.steps.videos.error = poll.error;
    fresh.steps.videos.updatedAt = Date.now();
    await saveProject(fresh);
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
    // 다운로드 시도(최대 60초) 동안 다른 저장이 있었을 수 있으니 최신 재읽기 후 머지.
    const fresh = (await getProject(projectId)) ?? project;
    fresh.steps.videos.status = "error";
    fresh.steps.videos.error = error;
    fresh.steps.videos.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, status: "failed", error });
  }

  // 다운로드+업로드(수십 초) 뒤 — 다른 씬의 동시 완료를 덮어쓰지 않도록 최신 상태 재읽기.
  // (자동 폴링이 여러 씬을 동시에 완료시킬 때 last-write-wins 로 videoUrl 이 사라지던 버그.)
  const fresh = (await getProject(projectId)) ?? project;
  const freshScene = fresh.scenes[sceneIndex] ?? scene;
  fresh.scenes[sceneIndex] = { ...freshScene, videoUrl, status: "generated" };
  // 씬0 은 keyframe 앵커라 videos 완료 판정에서 제외(이미지 단계와 동일 정책).
  const allDone = fresh.scenes.slice(1).every((s) => s.skipped || !!s.videoUrl);
  fresh.steps.videos.status = allDone ? "generated" : "generating";
  fresh.steps.videos.updatedAt = Date.now();
  fresh.updatedAt = Date.now();
  await saveProject(fresh);

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
