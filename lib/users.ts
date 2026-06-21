// ============================================================================
// 사용자 저장소 (Upstash Redis) — 이메일+비밀번호 가입용. 비용 청구를 위해
// 가입 이메일을 받아 둔다. user:{email} → { email, passwordHash, createdAt }.
// ============================================================================

import { getRedis } from "./redis";

export interface User {
  email: string;
  passwordHash: string;
  createdAt: number;
}

const KEY = (email: string) => `user:${email.toLowerCase()}`;
const USERS_SET = "users";

export async function getUser(email: string): Promise<User | null> {
  return (await getRedis().get<User>(KEY(email))) ?? null;
}

export async function createUser(email: string, passwordHash: string): Promise<User> {
  const user: User = { email: email.toLowerCase(), passwordHash, createdAt: Date.now() };
  await getRedis().set(KEY(user.email), user);
  await getRedis().sadd(USERS_SET, user.email);
  return user;
}

export async function updateUserPassword(email: string, passwordHash: string): Promise<void> {
  const user = await getUser(email);
  if (!user) return;
  await getRedis().set(KEY(email), { ...user, passwordHash });
}

export async function listUserEmails(): Promise<string[]> {
  return (await getRedis().smembers(USERS_SET)) ?? [];
}
