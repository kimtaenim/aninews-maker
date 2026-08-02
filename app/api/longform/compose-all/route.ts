import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getProject, saveProject } from "@/lib/projectStore";
import { enqueueJob, getJob, updateJob, type Job } from "@/lib/jobQueue";
import { getRedis } from "@/lib/redis";

export const runtime = "nodejs";

// [롱폼] 최종 합성 전체 체인을 큐에 한 번에 — 편별 합성(없는 편만) → 묶음 합성 → 이어붙이기.
// 워커가 FIFO 순차 처리(lpush+rpop, 단일 루프)라 순서만 맞춰 넣으면 앞 잡의 산출물이
// 뒤 잡의 입력이 된다. ★브라우저는 넣고 나면 필요 없다 — 탭을 닫아도 끝까지 굽는다
// (2026-08-02 지적: 3분짜리 굽는 동안 탭을 열어두게 만든 클라이언트 체인은 잘못).
//   POST { projectId } → { ok, queued } | 409(어느 편이 왜 준비 안 됐는지)
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const longform = await getProject(projectId);
  if (!longform) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  const segIds = longform.sourceProjectIds ?? [];
  if (!segIds.length) return NextResponse.json({ ok: false, error: "편이 없어요" }, { status: 422 });

  const now = Date.now();
  const mkJob = (pid: string, payload: Job["payload"]): Job => ({
    id: randomUUID(),
    type: "compose",
    projectId: pid,
    payload,
    status: "queued",
    createdAt: now,
    updatedAt: now,
  });

  // 1) 편별 — 최종본 없는 편만. 영상이 덜 된 편이 있으면 큐에 넣지 않고 어디가 왜인지 알려준다.
  const needSeg: string[] = [];
  const notReady: string[] = [];
  for (const id of segIds) {
    const seg = await getProject(id);
    if (!seg) continue;
    if (seg.finalVideoUrl) continue;
    const missing = (seg.scenes ?? []).filter((s) => !s.skipped && !s.videoUrl).length;
    if (missing > 0) {
      notReady.push(`"${seg.title.slice(0, 20)}…" 영상 ${missing}개 미완 — 그 편 '만들기' 먼저`);
    } else {
      needSeg.push(id);
    }
  }
  if (notReady.length) {
    return NextResponse.json({ ok: false, error: notReady.join(" / ") }, { status: 409 });
  }

  let queuedSegments = 0;
  for (const id of needSeg) {
    const seg = await getProject(id);
    if (!seg) continue;
    const job = mkJob(id, { lang: "ko" });
    await enqueueJob(job);
    seg.steps.compose.status = "generating";
    seg.steps.compose.error = undefined;
    seg.steps.compose.jobId = job.id;
    seg.steps.compose.updatedAt = now;
    seg.updatedAt = now;
    await saveProject(seg);
    queuedSegments++;
  }

  // 2) 묶음(없는 것만) + 3) 이어붙이기 — 저장은 fresh 재읽기 후 한 번에.
  const fresh = (await getProject(projectId)) ?? longform;
  let queuedSections = 0;
  for (const sec of fresh.sections ?? []) {
    if (sec.videoUrl) continue;
    const job = mkJob(projectId, { lang: "ko", sectionId: sec.id });
    await enqueueJob(job);
    sec.status = "generating";
    sec.jobId = job.id;
    sec.error = undefined;
    sec.updatedAt = now;
    queuedSections++;
  }
  const joinJob = mkJob(projectId, { lang: "ko", joinSections: true });
  await enqueueJob(joinJob);
  fresh.steps.compose.status = "generating";
  fresh.steps.compose.error = undefined;
  fresh.steps.compose.jobId = joinJob.id;
  fresh.steps.compose.updatedAt = now;
  fresh.updatedAt = now;
  await saveProject(fresh);

  return NextResponse.json({
    ok: true,
    queued: { segments: queuedSegments, sections: queuedSections, join: true },
  });
}

// 합성 중단 — 대기열에 남은 이 롱폼 가족(편·묶음·이어붙이기) 잡을 걷어내고 상태를 되돌린다.
// 워커가 이미 잡아 굽는 중인 것 하나는 원격으로 못 죽인다 — 그 결과는 무해하게 저장될 뿐이고,
// 나머지 체인은 돌지 않는다.
//   DELETE ?projectId → { ok, removed }
export async function DELETE(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  const longform = await getProject(projectId);
  if (!longform) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });

  const family = new Set(
    [projectId, ...(longform.sourceProjectIds ?? []), longform.hostProjectId].filter(
      (x): x is string => !!x
    )
  );
  const redis = getRedis();
  const queued = (await redis.lrange<string>("jobq:compose", 0, -1)) ?? [];
  let removed = 0;
  for (const id of queued) {
    const job = await getJob(id);
    if (job && family.has(job.projectId)) {
      await redis.lrem("jobq:compose", 0, id);
      await updateJob(id, { status: "error", error: "사용자 중단", updatedAt: Date.now() });
      removed++;
    }
  }
  const now = Date.now();
  // 편 상태 되돌리기
  for (const id of longform.sourceProjectIds ?? []) {
    const seg = await getProject(id);
    if (seg && seg.steps.compose.status === "generating" && !seg.finalVideoUrl) {
      seg.steps.compose.status = "pending";
      seg.steps.compose.error = "사용자 중단";
      seg.steps.compose.updatedAt = now;
      seg.updatedAt = now;
      await saveProject(seg);
    }
  }
  const fresh = (await getProject(projectId)) ?? longform;
  for (const sec of fresh.sections ?? []) {
    if (sec.status === "generating" && !sec.videoUrl) {
      sec.status = "pending";
      sec.error = undefined;
      sec.updatedAt = now;
    }
  }
  if (fresh.steps.compose.status === "generating") {
    fresh.steps.compose.status = fresh.finalVideoUrl ? "generated" : "pending";
    fresh.steps.compose.error = "사용자 중단";
    fresh.steps.compose.updatedAt = now;
  }
  fresh.updatedAt = now;
  await saveProject(fresh);
  return NextResponse.json({ ok: true, removed });
}
