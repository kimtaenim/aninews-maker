// ============================================================================
// 대본 구조 검수 로그 — 진단 결과·동의 여부·채택본 저장(추후 완주율과 조인).
// ----------------------------------------------------------------------------
// scriptreview:<projectId> 에 1건, scriptreview:ids 셋. 실패는 조용히 무시.
// ============================================================================

import { getRedis } from "./redis";
import { reviewFingerprint, type ScriptReviewResult } from "./scriptReview";

const KEY = (id: string) => `scriptreview:${id}`;
const INDEX = "scriptreview:ids";

export interface ReviewLog {
  projectId: string;
  result: ScriptReviewResult;
  reviewedAt: number;
  fingerprint: string; // 검수 당시 대본 지문 — 리로드 복원 시 최신 여부 판정용
  outcome?: { consented: boolean; adopted?: "all" | "partial" | "manual" | "none"; at: number };
}

// 검수 결과 저장 — 당시 대본 지문을 함께 남겨, 리로드 후에도 최신일 때만 복원한다.
export async function saveReviewLog(
  projectId: string,
  result: ScriptReviewResult,
  narrations: string[]
): Promise<void> {
  try {
    const redis = getRedis();
    const log: ReviewLog = {
      projectId,
      result,
      reviewedAt: Date.now(),
      fingerprint: reviewFingerprint(narrations),
    };
    await redis.set(KEY(projectId), log);
    await redis.sadd(INDEX, projectId);
  } catch {
    /* 무시 */
  }
}

// 저장된 다듬기 결과 읽기 — 페이지 로드 시 복원(자리 비웠다 와도 결과 유지).
export async function getReviewLog(projectId: string): Promise<ReviewLog | null> {
  try {
    return (await getRedis().get<ReviewLog>(KEY(projectId))) ?? null;
  } catch {
    return null;
  }
}

// 동의/채택 결과 기록 — 검수 로그가 있을 때만 머지.
export async function setReviewOutcome(
  projectId: string,
  outcome: { consented: boolean; adopted?: "all" | "partial" | "manual" | "none"; finalNarrations?: string[] }
): Promise<void> {
  try {
    const redis = getRedis();
    const cur = (await redis.get<Record<string, unknown>>(KEY(projectId))) ?? null;
    if (!cur) return;
    cur.outcome = { ...outcome, at: Date.now() };
    await redis.set(KEY(projectId), cur);
  } catch {
    /* 무시 */
  }
}
