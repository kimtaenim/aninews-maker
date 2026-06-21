import { NextRequest, NextResponse } from "next/server";
import { getUser, createUser } from "@/lib/users";
import { hashPassword } from "@/lib/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 가입(누구나) — 이메일+비밀번호. 가입 즉시 세션 발급(로그인 상태).
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: "이메일 형식이 올바르지 않아요" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ ok: false, error: "비밀번호는 6자 이상이어야 해요" }, { status: 400 });
  }
  if (await getUser(email)) {
    return NextResponse.json({ ok: false, error: "이미 가입된 이메일이에요 (로그인해주세요)" }, { status: 409 });
  }

  const hash = await hashPassword(password);
  await createUser(email, hash);
  const token = await createSessionToken(email);
  const res = NextResponse.json({ ok: true, email });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
  return res;
}
