import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getProject, saveProject } from "@/lib/projectStore";
import { enqueueJob, type Job } from "@/lib/jobQueue";

export const runtime = "nodejs";

// 7. compose — 최종 합성 작업을 worker 에 위임(Redis 큐). ffmpeg 는 Vercel 에서
// 못 돌리므로 별도 worker 가 처리. 언어(ko/en) 하나를 골라 그 판을 굽는다.
//   POST { projectId, lang? }  → 큐 적재 → { jobId }
//   GET  ?projectId            → { status, finalVideoUrl?, error? }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; lang?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const lang = body.lang === "en" ? "en" : "ko";

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  const withVideo = project.scenes.filter((s) => s.videoUrl);
  if (withVideo.length === 0) {
    return NextResponse.json(
      { ok: false, error: "비디오가 있는 씬이 없어요 (5단계 먼저)" },
      { status: 409 }
    );
  }

  const now = Date.now();
  const job: Job = {
    id: randomUUID(),
    type: "compose",
    projectId,
    payload: { lang },
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  await enqueueJob(job);

  project.steps.compose.status = "generating";
  project.steps.compose.error = undefined;
  project.steps.compose.jobId = job.id;
  project.steps.compose.updatedAt = now;
  project.updatedAt = now;
  await saveProject(project);

  return NextResponse.json({ ok: true, jobId: job.id });
}

export async function GET(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  return NextResponse.json({
    ok: true,
    status: project.steps.compose.status,
    finalVideoUrl: project.finalVideoUrl,
    error: project.steps.compose.error,
  });
}
