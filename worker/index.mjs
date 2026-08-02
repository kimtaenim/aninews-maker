// aninews 합성 워커 — Redis 큐(jobq:compose)를 폴링해 ffmpeg 합성 실행.
// Render Background Worker 등 상시 서버에서 `node index.mjs` 로 가동.
import { popComposeJob, updateJob, failCompose, redis } from "./store.mjs";
import { composeProject, abortActiveWork } from "./compose.mjs";

const POLL_MS = 4000;
const COMPOSE_TIMEOUT_MS = 10 * 60 * 1000; // 10분 넘게 매달리면 에러 처리(무한대기 제거)

// 워커는 죽으면 안 된다 — 잡 하나가 실패해도 프로세스는 살아 다음 잡을 받아야 한다.
// 예전엔 핸들러가 없어서 자식 spawn 실패나 Redis 한 번의 오류가 곧바로 프로세스 종료
// (그리고 Render 재시작)로 이어졌고, 그때 돌던 잡은 running 인 채로 영원히 남았다.
process.on("uncaughtException", (e) => {
  console.error("[worker] uncaughtException — 무시하고 계속:", e?.stack ?? e);
});
process.on("unhandledRejection", (e) => {
  console.error("[worker] unhandledRejection — 무시하고 계속:", e?.stack ?? e);
});

// 실패 기록은 그 자체가 또 실패할 수 있다(Upstash 순간 오류). 여기서 던지면 tick 이 reject 되고
// 최상위 for 루프까지 올라가 프로세스가 죽는다 — 반드시 삼킨다.
async function safely(what, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`[worker] ${what} 실패(무시):`, e?.message ?? e);
  }
}

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
  let timer = null;
  try {
    await safely("running 기록", () => updateJob(job.id, { status: "running" }));
    const url = await Promise.race([
      composeProject(job.projectId, job.payload?.lang ?? "ko", job.payload),
      new Promise((_, rej) => {
        timer = setTimeout(() => {
          // Promise.race 는 진 쪽을 취소하지 않는다 — 버려진 합성이 계속 ffmpeg 를 돌려
          // 다음 잡과 메모리가 겹치는 걸 막으려면 자식 프로세스를 직접 죽여야 한다.
          const n = abortActiveWork();
          rej(new Error(`합성 타임아웃(10분) — 워커가 어딘가에서 매달림 (자식 ${n}개 종료)`));
        }, COMPOSE_TIMEOUT_MS);
      }),
    ]);
    await safely("done 기록", () => updateJob(job.id, { status: "done", resultUrl: url }));
    console.log(`[worker] compose 완료 → ${url}`);
  } catch (e) {
    const msg = String(e?.message ?? e);
    console.error(`[worker] compose 실패 job=${job.id}:`, msg);
    // 실패했으면 남은 자식이 없어야 한다(있으면 다음 잡과 메모리가 겹친다).
    abortActiveWork();
    await safely("error 기록", () => updateJob(job.id, { status: "error", error: msg }));
    await safely("프로젝트 실패 표시", () => failCompose(job.projectId, msg));
  } finally {
    if (timer) clearTimeout(timer); // 안 지우면 타이머가 살아 다음 잡 중에 터진다
  }
}

// 배포 검증용 버전 표식 — Render 로그 + Redis(worker:build)에 남긴다.
// Redis 에 쓰면 대시보드 없이 원격에서 "새 코드가 떴는지" 확인 가능.
const BUILD = "robust-v2 (부 전환 페이드아웃 + 0.4초 검은 휴식)";
console.log(`[worker] BUILD = ${BUILD}`);
console.log("[worker] 시작 — jobq:compose 폴링 중…");
try {
  await redis.set("worker:build", { build: BUILD, startedAt: Date.now() });
} catch {}
// 생존 신호 — 1분마다 갱신(폴링 대비 미미한 추가 커맨드). 확인: GET worker:heartbeat.
let lastBeat = 0;
for (;;) {
  // tick 은 내부에서 다 삼키지만, 혹시 새는 게 있어도 루프는 계속 돈다.
  await tick().catch((e) => console.error("[worker] tick 예외(무시):", e?.message ?? e));
  if (Date.now() - lastBeat > 60_000) {
    lastBeat = Date.now();
    try {
      await redis.set("worker:heartbeat", Date.now());
    } catch {}
  }
  await new Promise((r) => setTimeout(r, POLL_MS));
}
