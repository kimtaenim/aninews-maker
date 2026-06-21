import { NextRequest, NextResponse } from "next/server";
import { getUser } from "@/lib/users";
import { verifyPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export const runtime = "nodejs";

// 로그인 — 이메일+비밀번호 검증 후 세션 발급.
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  const user = await getUser(email);
  // 이메일 존재 여부를 노출하지 않도록 동일 메시지.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    return NextResponse.json(
      { ok: false, error: "이메일 또는 비밀번호가 맞지 않아요" },
      { status: 401 }
    );
  }

  const token = await createSessionToken(user.email);
  const res = NextResponse.json({ ok: true, email: user.email });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
