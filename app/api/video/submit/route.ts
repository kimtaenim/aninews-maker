import { NextResponse } from "next/server";

// 5. videos (제출) — 분 단위 비동기. 씬 이미지 → fal image-to-video 작업 enqueue.
// Vercel 함수는 enqueue 만 하고 즉시 jobId 반환. 실제 폴링/실행은 worker.
// TODO: enqueueJob({ type:"video", projectId, sceneIndex, payload:{ imageUrl, motion, modelId } })
export async function POST() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
