// ============================================================================
// 인증 헬퍼 (Node 전용) — 비밀번호 해싱(bcrypt) + 현재 세션 이메일 읽기.
// edge(middleware)에서는 lib/session.ts 만 쓴다(bcrypt·next/headers 미사용).
// ============================================================================

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

// 소유자 없는 기존 프로젝트는 이 계정 소유로 본다(라이브러리·비용 귀속).
export const ADMIN_EMAIL = "kimtaenim@gmail.com";

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// 서버 컴포넌트/라우트 핸들러에서 현재 로그인 이메일(없으면 null).
export async function getSessionEmail(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
