// ============================================================================
// 세션 토큰 (JWT) — edge(middleware)와 Node 양쪽에서 안전한 jose 만 사용.
// 비밀번호 해싱(bcrypt)·쿠키 읽기(next/headers)는 lib/auth.ts(Node 전용)에 둔다.
// ============================================================================

import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "aninews_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30일
const ALG = "HS256";

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET missing in .env.local (세션 서명 키)");
  return new TextEncoder().encode(s);
}

export async function createSessionToken(email: string): Promise<string> {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

// 유효하면 이메일, 아니면 null.
export async function verifySessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}
