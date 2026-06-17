import { NextResponse } from "next/server";

// 5. videos (폴링) — 클라이언트가 jobId 로 상태 확인. worker 가 갱신한 Job 을 읽음.
// TODO: getJob(jobId) → { status, resultUrl? }
export async function GET() {
  return NextResponse.json({ error: "not implemented" }, { status: 501 });
}
