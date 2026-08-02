// aninews 합성 워커 — Redis 큐(jobq:compose)를 폴링해 ffmpeg 합성 실행.
// Render Background Worker 등 상시 서버에서 `node index.mjs` 로 가동.
import { popComposeJob, updateJob, requeueJobFront, failCompose, redis } from "./store.mjs";
import { composeProject, abortActiveWork } from "./compose.mjs";

const POLL_MS = 4000;
const COMPOSE_TIMEOUT_MS = 10 * 60 * 1000; // 10분 넘게 매달리면 에러 처리(무한대기 제거)

// 일시 오류 판별 — 이 패턴이면 사용자에게 실패를 던지지 않고 자동 재시도한다.
// 타임아웃("합성 타임아웃")·ffmpeg 실패·"완성본이 없어요" 류는 일부러 제외:
// 같은 입력이면 같은 결과라 재시도가 시간만 태운다(크래시 루프 방지).
const RETRYABLE =
  /disturbed or locked|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|fetch failed|socket|other side closed|terminated|UND_ERR|다운로드 실패 (429|5\d\d)/i;
const MAX_RETRY = 2;

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
    // 지금 굽는 잡 표식 — 프로세스가 여기서 죽으면(배포 재시작·OOM) 다음 기동이 이걸 보고
    // 잡을 자동 재개한다. 아래 finally 에서 지운다.
    await safely("current 기록", () => redis.set("worker:current", job.id));
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
    // 실패했으면 남은 자식이 없어야 한다(있으면 다음 잡과 메모리가 겹친다).
    abortActiveWork();
    // [자동 재시도] 일시 오류(네트워크·업로드·다운로드 5xx)는 사용자에게 던지지 않고
    // 최대 2회 조용히 다시 돈다 — 순간 삐끗이 곧바로 "실패" 화면이 되던 구조 수정
    // (2026-08-02). 타임아웃·ffmpeg 오류·자산 없음은 재시도 안 함(같은 결과 반복 방지).
    const attempts = (job.attempts ?? 0) + 1;
    if (attempts <= MAX_RETRY && RETRYABLE.test(msg)) {
      console.error(`[worker] 일시 오류 — 자동 재시도 ${attempts}/${MAX_RETRY}: ${msg}`);
      await safely("재시도 큐", () =>
        requeueJobFront({ ...job, attempts }, {
          status: "queued",
          error: `일시 오류 — 자동 재시도 ${attempts}/${MAX_RETRY} 대기: ${msg.slice(0, 200)}`,
        })
      );
    } else {
      console.error(`[worker] compose 실패 job=${job.id}:`, msg);
      await safely("error 기록", () => updateJob(job.id, { status: "error", error: msg }));
      await safely("프로젝트 실패 표시", () => failCompose(job.projectId, msg));
    }
  } finally {
    if (timer) clearTimeout(timer); // 안 지우면 타이머가 살아 다음 잡 중에 터진다
    await safely("current 해제", () => redis.del("worker:current"));
  }
}

// 배포 검증용 버전 표식 — Render 로그 + Redis(worker:build)에 남긴다.
// Redis 에 쓰면 대시보드 없이 원격에서 "새 코드가 떴는지" 확인 가능.
const BUILD = "robust-v6 (오디오 싱크 고정 — 이어붙이기 때 무음 채움, 끝부분 밀림 수정)";
console.log(`[worker] BUILD = ${BUILD}`);
console.log("[worker] 시작 — jobq:compose 폴링 중…");
try {
  await redis.set("worker:build", { build: BUILD, startedAt: Date.now() });
} catch {}

// [중단 잡 자동 재개] 단일 워커라, 기동 시점에 worker:current 가 남아 있으면 직전
// 프로세스가 그 잡을 굽다 죽은 것(배포 재시작·OOM). 한 번은 조용히 다시 굽고,
// 두 번째로 또 죽었으면 그 잡 자체가 워커를 죽이는 것으로 보고 명확히 실패 처리한다
// (크래시 루프 방지). 과거 실패 기록 최다 유형("워커가 합성 도중 종료")의 근본 처리.
// Render 재배포가 새 프로세스를 먼저 띄우는 짧은 겹침 창에선 산 잡을 재큐할 수도
// 있는데, 합성은 멱등(나중 저장이 이김)이라 중복 굽기 손해로 그친다.
try {
  const orphanId = await redis.get("worker:current");
  if (orphanId) {
    const job = await redis.get(`job:${orphanId}`);
    if (job && job.status === "running") {
      const restarts = (job.restarts ?? 0) + 1;
      if (restarts <= 1) {
        console.log(`[worker] 중단된 잡 자동 재개 — ${orphanId}`);
        await requeueJobFront({ ...job, restarts }, {
          status: "queued",
          error: `워커 재시작으로 중단 — 자동 재개 ${restarts}/1`,
        });
      } else {
        await updateJob(orphanId, {
          status: "error",
          error: "이 잡을 굽는 중 워커가 두 번 종료됨 — 잡 자체가 원인일 수 있어 자동 재개를 멈췄어요",
        });
        await failCompose(job.projectId, "합성 중 워커가 반복 종료 — 다시 시도해 주세요");
      }
    }
    await redis.del("worker:current");
  }
} catch (e) {
  console.error("[worker] 중단 잡 확인 실패(무시):", e?.message ?? e);
}
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
