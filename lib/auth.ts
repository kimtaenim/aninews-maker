// ============================================================================
// 인증 헬퍼 (Node 전용) — 비밀번호 해싱(bcrypt) + 현재 세션 이메일 읽기.
// edge(middleware)에서는 lib/session.ts 만 쓴다(bcrypt·next/headers 미사용).
// ============================================================================

import bcrypt from "bcryptjs"; // 레거시 해시 검증 전용(신규는 scrypt)
import { scrypt as _scrypt, randomBytes, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySessionToken } from "./session";

// 소유자 없는 기존 프로젝트는 이 계정 소유로 본다(라이브러리·비용 귀속).
export const ADMIN_EMAIL = "kimtaenim@gmail.com";

// 비밀번호 해싱: Node 네이티브 scrypt(~수십ms). bcryptjs(순수 JS, ~1초+)보다 훨씬 빠름.
const scrypt = promisify(_scrypt);
const SCRYPT_KEYLEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith("scrypt$")) {
    const [, salt, hashHex] = stored.split("$");
    if (!salt || !hashHex) return false;
    const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
    const expected = Buffer.from(hashHex, "hex");
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  }
  // 레거시 bcrypt 해시($2…) — 가입자 호환.
  if (stored.startsWith("$2")) return bcrypt.compare(password, stored);
  return false;
}

// 레거시(bcrypt) 해시면 로그인 성공 후 scrypt 로 재해싱(다음부턴 빠름).
export function isLegacyHash(stored: string): boolean {
  return stored.startsWith("$2");
}

// 서버 컴포넌트/라우트 핸들러에서 현재 로그인 이메일(없으면 null).
export async function getSessionEmail(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}
