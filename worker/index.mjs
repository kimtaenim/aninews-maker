// aninews 합성 워커 — Redis 큐(jobq:compose)를 폴링해 ffmpeg 합성 실행.
// Render Background Worker 등 상시 서버에서 `node index.mjs` 로 가동.
import { popComposeJob, updateJob } from "./store.mjs";
import { composeProject } from "./compose.mjs";

const POLL_MS = 4000;

async function tick() {
  let job;
  try {
    job = await popComposeJob();
  } catch (e) {
    console.error("[worker] 큐 폴링 에러:", e?.message ?? e);
    return;
  }
  if (!job) return;

  console.log(`[worker] compose 시작 job=${job.id} project=${job.projectId} lang=${job.payload?.lang}`);
  try {
    await updateJob(job.id, { status: "running" });
    const url = await composeProject(job.projectId, job.payload?.lang ?? "ko");
    await updateJob(job.id, { status: "done", resultUrl: url });
    console.log(`[worker] compose 완료 → ${url}`);
  } catch (e) {
    console.error(`[worker] compose 실패 job=${job.id}:`, e?.message ?? e);
    await updateJob(job.id, { status: "error", error: String(e?.message ?? e) });
  }
}

// 배포 검증용 버전 표식 — 이 줄이 Render 로그에 보이면 "새 자막(libass) 코드"가 떴다는 뜻.
console.log("[worker] BUILD = subtitle-libass-v2 (가운데정렬 + 큰글씨 + cover-crop, 검은테두리 제거)");
console.log("[worker] 시작 — jobq:compose 폴링 중…");
for (;;) {
  await tick();
  await new Promise((r) => setTimeout(r, POLL_MS));
}
