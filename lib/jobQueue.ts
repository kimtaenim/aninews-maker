// ============================================================================
// 서버 잡 큐 (Redis) — cardnews jobs.ts 가 예고한 "Phase B" (골격)
// ----------------------------------------------------------------------------
// fal 영상 폴링 / ffmpeg 합성처럼 Vercel 함수 수명을 넘는 장시간 작업을 별도
// 상시 worker 가 처리하게 하는 큐. Vercel API 는 enqueue 만, worker 는 폴링·실행·
// 상태 갱신을 담당. worker 는 같은 Redis 를 본다 (WORKER_SHARED_SECRET 로 인증).
// ============================================================================

import { getRedis } from "./redis";

export type JobType = "video" | "compose" | "subtitle";
export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: string;
  type: JobType;
  projectId: string;
  sceneIndex?: number; // video 잡은 씬 단위
  payload: Record<string, unknown>;
  status: JobStatus;
  resultUrl?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const QUEUE = (type: JobType) => `jobq:${type}`; // list (worker 가 LPOP/BRPOP)
const JOB = (id: string) => `job:${id}`;

export async function enqueueJob(job: Job): Promise<void> {
  const redis = getRedis();
  await redis.set(JOB(job.id), job);
  await redis.lpush(QUEUE(job.type), job.id);
}

export async function getJob(id: string): Promise<Job | null> {
  return (await getRedis().get<Job>(JOB(id))) ?? null;
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<Job | null> {
  const redis = getRedis();
  const cur = await getJob(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, updatedAt: patch.updatedAt ?? cur.updatedAt };
  await redis.set(JOB(id), next);
  return next;
}

// worker 측 소비 헬퍼는 worker/ 에서 BRPOP 으로 구현 (여기선 enqueue/조회만).
