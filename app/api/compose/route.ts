import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getProject, saveProject, getComposeProgressLine } from "@/lib/projectStore";
import { enqueueJob, type Job } from "@/lib/jobQueue";
import { isTargetLang } from "@/lib/languages";

export const runtime = "nodejs";

// 7. compose — 최종 합성 작업을 worker 에 위임(Redis 큐). ffmpeg 는 Vercel 에서
// 못 돌리므로 별도 worker 가 처리. 언어(ko 또는 더빙 언어 en/es/ja…) 하나를 골라 굽는다.
//   POST { projectId, lang?, clean? }  → 큐 적재 → { jobId }. clean=true 는 "영상만"
//     합성(보이스·자막·효과음·워터마크 제외 — 소재용) → cleanVideoUrl 에 저장.
//   GET  ?projectId            → { status, finalVideoUrl?, cleanVideoUrl?, error? }
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    lang?: string;
    clean?: boolean;
    sectionId?: string; // [롱폼] 섹션 하나만 부분 합성
    joinSections?: boolean; // [롱폼] 섹션 영상들 최종 이어붙이기
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
  const lang = isTargetLang(body.lang) ? (body.lang as string) : "ko";
  const sectionId = (body.sectionId ?? "").trim() || null;
  const joinSections = body.joinSections === true;

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // 롱폼(씬 없음)은 씬 검증을 건너뛴다 — 유효성은 워커가 세그먼트/섹션 완성본으로 판단.
  const isLongform =
    project.format === "long" &&
    Array.isArray(project.sourceProjectIds) &&
    project.sourceProjectIds.length > 0;
  if (!isLongform) {
    const withVideo = project.scenes.filter((s) => s.videoUrl);
    if (withVideo.length === 0) {
      return NextResponse.json(
        { ok: false, error: "비디오가 있는 씬이 없어요 (5단계 먼저)" },
        { status: 409 }
      );
    }
  }

  // 섹션 부분 합성이면 대상 섹션이 있어야 한다.
  const section = sectionId ? project.sections?.find((s) => s.id === sectionId) : null;
  if (sectionId && !section) {
    return NextResponse.json({ ok: false, error: "섹션을 찾을 수 없어요" }, { status: 404 });
  }

  const now = Date.now();
  const job: Job = {
    id: randomUUID(),
    type: "compose",
    projectId,
    payload: {
      lang,
      ...(body.clean === true ? { clean: true } : {}),
      ...(sectionId ? { sectionId } : {}),
      ...(joinSections ? { joinSections: true } : {}),
    },
    status: "queued",
    createdAt: now,
    updatedAt: now,
  };
  await enqueueJob(job);

  if (section) {
    // 섹션 잡: 프로젝트 전체 compose 스텝이 아니라 그 섹션 상태만 켠다(섹션별 스피너).
    section.status = "generating";
    section.jobId = job.id;
    section.error = undefined;
    section.updatedAt = now;
  } else {
    project.steps.compose.status = "generating";
    project.steps.compose.error = undefined;
    project.steps.compose.jobId = job.id;
    project.steps.compose.updatedAt = now;
  }
  project.updatedAt = now;
  await saveProject(project);

  return NextResponse.json({ ok: true, jobId: job.id });
}

// 합성 중단 — 멈춘(또는 매달린) 합성을 취소하고 상태를 리셋해 UI 스피너를 푼다.
// (워커가 실제 처리 중이면 곧 워커 타임아웃이 정리한다.)
export async function DELETE(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const project = await getProject(projectId);
  if (project) {
    project.steps.compose.status = "error";
    project.steps.compose.error = "사용자가 중단했어요";
    project.steps.compose.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await saveProject(project);
  }
  return NextResponse.json({ ok: true });
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
  const progress = await getComposeProgressLine(projectId);
  return NextResponse.json({
    ok: true,
    status: project.steps.compose.status,
    finalVideoUrl: project.finalVideoUrl,
    cleanVideoUrl: project.cleanVideoUrl, // "영상만" 합성본(있으면)
    error: project.steps.compose.error,
    updatedAt: project.steps.compose.updatedAt, // 합성 시작 시각(경과시간 복원용)
    progress, // 워커 진행 로그 마지막 줄 (예: "씬 6/8: 인코딩…")
    // [롱폼] 섹션 상태 — 섹션별 부분 합성 스피너·완료 판정용(있을 때만).
    sections: Array.isArray(project.sections)
      ? project.sections.map((s) => ({
          id: s.id,
          segmentIds: s.segmentIds,
          videoUrl: s.videoUrl,
          status: s.status,
          error: s.error,
        }))
      : undefined,
  });
}
