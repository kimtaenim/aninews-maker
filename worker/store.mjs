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

// 합성 단계별 진행 로그 — Redis 리스트에 append. 클라/개발자가 lrange 로 읽어 어디서
// 멈췄는지 본다. (Render 로그 복붙 없이 원격에서 진행 추적 가능)
const progKey = (projectId) => `compose:progress:${projectId}`;
export async function resetProgress(projectId) {
  try {
    await redis.del(progKey(projectId));
  } catch {}
}
export async function logProgress(projectId, msg) {
  try {
    const line = `${new Date().toISOString().slice(11, 23)} ${msg}`;
    await redis.rpush(progKey(projectId), line);
    await redis.expire(progKey(projectId), 3600);
  } catch {}
}
export async function getProgress(projectId) {
  try {
    return await redis.lrange(progKey(projectId), 0, -1);
  } catch {
    return [];
  }
}

// 합성 실패 표시 — 프로젝트 단계 상태를 error 로. (타임아웃 등 composeProject 밖에서 호출)
export async function failCompose(projectId, error) {
  try {
    const p = await getProject(projectId);
    if (!p) return;
    p.steps.compose.status = "error";
    p.steps.compose.error = String(error);
    p.steps.compose.updatedAt = Date.now();
    await saveProject(p);
  } catch {}
}
