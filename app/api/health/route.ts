import { NextResponse } from "next/server";

export const runtime = "nodejs";

// 지금 떠 있는 빌드가 어느 커밋인지 — 푸시 뒤 배포가 실제로 나갔는지 확인하는 용도.
// (Vercel 이 빌드 때 VERCEL_GIT_COMMIT_SHA 를 넣어 준다. 로컬 dev 에선 "local".)
// 5연속 배포 실패를 아무도 모른 채 지나간 사고(2026-08-02)의 재발 방지 장치다.
export async function GET() {
  return NextResponse.json({
    ok: true,
    sha: process.env.VERCEL_GIT_COMMIT_SHA ?? "local",
    at: Date.now(),
  });
}
