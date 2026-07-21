// aninews 합성 워커 — Redis 큐(jobq:compose)를 폴링해 ffmpeg 합성 실행.
// Render Background Worker 등 상시 서버에서 `node index.mjs` 로 가동.
import { popComposeJob, updateJob, failCompose, redis } from "./store.mjs";
import { composeProject } from "./compose.mjs";

const POLL_MS = 4000;
const COMPOSE_TIMEOUT_MS = 10 * 60 * 1000; // 10분 넘게 매달리면 에러 처리(무한대기 제거)

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
    const url = await Promise.race([
      composeProject(job.projectId, job.payload?.lang ?? "ko", job.payload),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("합성 타임아웃(10분) — 워커가 어딘가에서 매달림")), COMPOSE_TIMEOUT_MS)
      ),
    ]);
    await updateJob(job.id, { status: "done", resultUrl: url });
    console.log(`[worker] compose 완료 → ${url}`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.error(`[worker] compose 실패 job=${job.id}:`, msg);
    await updateJob(job.id, { status: "error", error: msg });
    await failCompose(job.projectId, msg);
  }
}

// 배포 검증용 버전 표식 — Render 로그 + Redis(worker:build)에 남긴다.
// Redis 에 쓰면 대시보드 없이 원격에서 "새 코드가 떴는지" 확인 가능.
const BUILD = "longform-v5 (섹션 부분 합성 + 최종 join — 2~3세그 섹션별 잡)";
console.log(`[worker] BUILD = ${BUILD}`);
console.log("[worker] 시작 — jobq:compose 폴링 중…");
try {
  await redis.set("worker:build", { build: BUILD, startedAt: Date.now() });
} catch {}
// 생존 신호 — 1분마다 갱신(폴링 대비 미미한 추가 커맨드). 확인: GET worker:heartbeat.
let lastBeat = 0;
for (;;) {
  await tick();
  if (Date.now() - lastBeat > 60_000) {
    lastBeat = Date.now();
    try {
      await redis.set("worker:heartbeat", Date.now());
    } catch {}
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
