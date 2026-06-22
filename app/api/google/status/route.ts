import { NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { isDriveConnected } from "@/lib/google";

export const runtime = "nodejs";

// 현재 사용자의 Google 드라이브 연결 여부.
export async function GET() {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, connected: false }, { status: 401 });
  return NextResponse.json({ ok: true, connected: await isDriveConnected(email) });
}
