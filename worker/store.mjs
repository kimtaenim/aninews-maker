// Redis(프로젝트 상태 + 작업 큐) 접근 — Vercel 앱과 같은 키 스킴.
import { Redis } from "@upstash/redis";

const url = process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN;
if (!url || !token) {
  console.error("UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN 필요");
  process.exit(1);
}
export const redis = new Redis({ url, token });

const projectKey = (id) => `project:${id}`;

export async function getProject(id) {
  return (await redis.get(projectKey(id))) ?? null;
}
export async function saveProject(p) {
  await redis.set(projectKey(p.id), p);
}

// 큐: Vercel 이 lpush(jobq:compose, id) + set(job:id). 워커는 rpop 으로 소비(FIFO).
export async function popComposeJob() {
  const id = await redis.rpop("jobq:compose");
  if (!id) return null;
  const job = await redis.get(`job:${id}`);
  return job ?? null;
}
export async function updateJob(id, patch) {
  const cur = await redis.get(`job:${id}`);
  if (!cur) return;
  await redis.set(`job:${id}`, { ...cur, ...patch, updatedAt: Date.now() });
}
