// ============================================================================
// worker 진입점 (골격) — Redis 큐 폴링 루프
// ----------------------------------------------------------------------------
// Vercel API 가 enqueueJob 으로 적재한 작업을 BRPOP 으로 꺼내 처리한다.
// 별도 상시 서버(Render/Railway/Fly)에서 `tsx worker/index.ts` 로 상주 실행.
// 실제 ffmpeg/fal 로직은 compose.ts / video.ts / subtitle-burn.ts 로 분리.
// ============================================================================

import { runCompose } from "./compose";
import { runVideo } from "./video";
import { runSubtitleBurn } from "./subtitle-burn";

const QUEUES = ["jobq:video", "jobq:compose", "jobq:subtitle"] as const;

async function main() {
  // TODO: Redis 클라이언트 생성(앱과 동일 env). WORKER_SHARED_SECRET 확인.
  console.log("[worker] starting; polling", QUEUES.join(", "));

  // 루프 골격 (의사 코드):
  //   while (true) {
  //     const [queue, jobId] = await redis.brpop(...QUEUES, 0);
  //     const job = await getJob(jobId);
  //     await updateJob(jobId, { status: "running" });
  //     try {
  //       const resultUrl = await dispatch(job);
  //       await updateJob(jobId, { status: "done", resultUrl });
  //     } catch (e) {
  //       await updateJob(jobId, { status: "error", error: String(e) });
  //     }
  //   }
  void runCompose;
  void runVideo;
  void runSubtitleBurn;
}

main().catch((e) => {
  console.error("[worker] fatal", e);
  process.exit(1);
});
