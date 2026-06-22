import { NextRequest, NextResponse } from "next/server";
import { exchangeCode, saveDriveToken } from "@/lib/google";
import { getSessionEmail } from "@/lib/auth";

export const runtime = "nodejs";

// Google OAuth 콜백 — code → refresh token 저장 후 원래 화면으로(?gdrive=connected|error).
export async function GET(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.redirect(new URL("/login", req.url));

  const back = req.nextUrl.searchParams.get("state") || "/library";
  const dest = new URL(back, req.nextUrl.origin);
  const code = req.nextUrl.searchParams.get("code");
  const err = req.nextUrl.searchParams.get("error");

  if (err || !code) {
    dest.searchParams.set("gdrive", "error");
    return NextResponse.redirect(dest);
  }
  try {
    const redirectUri = new URL("/api/google/callback", req.nextUrl.origin).toString();
    const { refreshToken } = await exchangeCode(code, redirectUri);
    if (!refreshToken) throw new Error("no refresh token");
    await saveDriveToken(email, refreshToken);
    dest.searchParams.set("gdrive", "connected");
  } catch {
    dest.searchParams.set("gdrive", "error");
  }
  return NextResponse.redirect(dest);
}
