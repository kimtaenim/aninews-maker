import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/google";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";

// Google 연결 시작 — 동의 화면으로 리다이렉트. ?back= 으로 돌아올 경로 지정(기본 /library).
export async function GET(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.redirect(new URL("/login", req.url));
  const back = req.nextUrl.searchParams.get("back") || "/library";
  const redirectUri = new URL("/api/google/callback", req.nextUrl.origin).toString();
  return NextResponse.redirect(buildAuthUrl(redirectUri, back));
}
