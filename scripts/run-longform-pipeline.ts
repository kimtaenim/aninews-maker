// 롱폼 세그먼트 파이프라인을 프로덕션에서 순서대로 돌린다 — 키프레임 → 이미지 → 영상.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/run-longform-pipeline.ts <longformId> [세그먼트index...]
// 이미 끝난 단계는 건너뛴다(중간에 끊겨도 다시 돌리면 이어서 함). 기존 이미지·영상은 덮지 않는다.
import { getProject } from "../lib/projectStore";
import { prodApi } from "./prod-api";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function step(label: string, method: string, path: string, body?: unknown) {
  const r = await prodApi(method, path, body);
  const j = (r.json ?? {}) as { ok?: boolean; error?: string };
  console.log(`  ${j.ok === false ? "✗" : "✓"} ${label} — HTTP ${r.status}${j.error ? ` / ${j.error}` : ""}`);
  return r;
}

async function runSegment(segId: string, order: number) {
  const p = await getProject(segId);
  if (!p) throw new Error(`세그먼트 없음: ${segId}`);
  console.log(`\n═══ 세그먼트 ${order}: ${p.title}`);
  const n = p.scenes.length;

  // 1) 키프레임 — 후보 3장 → 첫 장 선택 → 승인
  if (p.steps.keyframe.status !== "approved" || !p.keyframeUrl) {
    const kf = await step("키프레임 후보 생성", "POST", "/api/image/keyframe", { projectId: segId });
    const urls = ((kf.json ?? {}) as { urls?: string[] }).urls ?? [];
    if (!urls.length) throw new Error("키프레임 후보가 안 나왔어요");
    await step(`후보 선택(${urls.length}장 중 1번)`, "POST", "/api/image/keyframe/select", {
      projectId: segId,
      url: urls[0],
    });
    await step("키프레임 승인", "POST", "/api/step/approve", { projectId: segId, step: "keyframe" });
  } else {
    console.log("  · 키프레임 이미 완료 — 건너뜀");
  }

  // 2) 씬 이미지 — 씬1부터(씬0 = 키프레임)
  let cur = await getProject(segId);
  const needImage = (cur?.scenes ?? [])
    .map((s, i) => (i > 0 && !s.imageUrl && !s.skipped ? i : -1))
    .filter((i) => i >= 0);
  if (needImage.length) {
    await step(`씬 이미지 ${needImage.length}장 생성`, "POST", "/api/image/scenes-batch", {
      projectId: segId,
      sceneIndexes: needImage,
    });
  } else {
    console.log("  · 씬 이미지 이미 완료 — 건너뜀");
  }
  cur = await getProject(segId);
  const missing = (cur?.scenes ?? []).filter((s, i) => i > 0 && !s.imageUrl && !s.skipped).length;
  if (missing) throw new Error(`이미지 ${missing}장이 안 나왔어요 — 여기서 멈춥니다`);
  if (cur?.steps.images.status !== "approved") {
    await step("이미지 승인", "POST", "/api/step/approve", { projectId: segId, step: "images" });
  }

  // 3) 영상 — 씬마다 제출하고 다 같이 폴링(제출은 빠르고 생성은 분 단위)
  cur = await getProject(segId);
  const needVideo = (cur?.scenes ?? [])
    .map((s, i) => (s.imageUrl && !s.videoUrl && !s.skipped && s.videoSource !== "upload" ? i : -1))
    .filter((i) => i >= 0);
  // ★ MiniMax 동시 실행 한도는 6 — 7번째부터 제출이 HTTP 500(동시 한도)로 튕긴다(실측).
  // 그래서 한 번에 MAX_INFLIGHT 개만 띄우고, 하나 끝날 때마다 다음 것을 제출한다.
  const MAX_INFLIGHT = 5;
  console.log(`  영상 대상 ${needVideo.length}컷: ${needVideo.join(", ")} (동시 ${MAX_INFLIGHT})`);
  const queue = [...needVideo];
  const pending = new Set<number>();
  const failed: number[] = [];

  const submitUpTo = async () => {
    while (pending.size < MAX_INFLIGHT && queue.length) {
      const i = queue[0];
      const r = await step(`씬${i} 영상 제출`, "POST", "/api/video/scene", { projectId: segId, sceneIndex: i });
      const j = (r.json ?? {}) as { ok?: boolean; error?: string };
      if (j.ok) {
        queue.shift();
        pending.add(i);
        await sleep(1500);
      } else if (/한도|레이트리밋|rate/i.test(j.error ?? "")) {
        return; // 한도에 걸렸으면 자리가 날 때까지 기다린다(큐에 그대로 둔다)
      } else {
        queue.shift();
        failed.push(i);
      }
    }
  };

  await submitUpTo();
  for (let round = 0; round < 120 && (pending.size || queue.length); round++) {
    await sleep(15_000);
    for (const i of [...pending]) {
      const r = await prodApi("GET", `/api/video/scene?projectId=${segId}&sceneIndex=${i}`);
      const j = (r.json ?? {}) as { status?: string; error?: string };
      if (j.status === "completed") {
        pending.delete(i);
        console.log(`  ✓ 씬${i} 영상 완료 (남은 ${pending.size + queue.length})`);
      } else if (j.status === "failed") {
        pending.delete(i);
        failed.push(i);
        console.log(`  ✗ 씬${i} 영상 실패 — ${j.error}`);
      }
    }
    await submitUpTo();
  }
  if (pending.size) console.log(`  ⏳ 미완 ${[...pending].join(", ")} — 나중에 다시 폴링 필요`);
  if (failed.length) console.log(`  ✗ 실패 ${failed.join(", ")}`);

  cur = await getProject(segId);
  const allVideo = (cur?.scenes ?? []).every((s, i) => i === 0 || s.skipped || !!s.videoUrl);
  if (allVideo && cur?.steps.videos.status !== "approved") {
    await step("영상 승인", "POST", "/api/step/approve", { projectId: segId, step: "videos" });
  }
  return { segId, failed, pending: [...pending] };
}

async function main() {
  const longformId = (process.argv[2] ?? "").trim();
  if (!longformId) throw new Error("사용법: run-longform-pipeline.ts <longformId> [세그먼트index...]");
  const lf = await getProject(longformId);
  if (!lf) throw new Error(`롱폼 없음: ${longformId}`);
  const segIds = lf.sourceProjectIds ?? [];
  const pick = process.argv.slice(3).map(Number).filter((n) => Number.isInteger(n));
  // 세그먼트를 가진 롱폼이면 그 세그먼트들을, 아니면(진행자 프로젝트 등) 그 프로젝트 하나를 돈다.
  const targets = segIds.length
    ? pick.length
      ? pick.map((i) => segIds[i]).filter(Boolean)
      : segIds
    : [longformId];
  console.log(`[${lf.title}] 대상 ${targets.length}개${segIds.length ? ` / 순서: ${segIds.join(", ")}` : " (단일 프로젝트)"}`);

  const results = [];
  for (let i = 0; i < targets.length; i++) {
    results.push(await runSegment(targets[i], i));
  }
  console.log(`\n═══ 정리`);
  for (const r of results) {
    console.log(`  ${r.segId}: 실패 ${r.failed.length}건 / 미완 ${r.pending.length}건`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
