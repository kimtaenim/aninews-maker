// ============================================================================
// 대본 구조 검수 로그 — 진단 결과·동의 여부·채택본 저장(추후 완주율과 조인).
// ----------------------------------------------------------------------------
// scriptreview:<projectId> 에 1건, scriptreview:ids 셋. 실패는 조용히 무시.
// ============================================================================

import { getRedis } from "./redis";
import type { ScriptReviewResult } from "./scriptReview";

const KEY = (id: string) => `scriptreview:${id}`;
const INDEX = "scriptreview:ids";

export async function saveReviewLog(projectId: string, result: ScriptReviewResult): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(KEY(projectId), { projectId, result, reviewedAt: Date.now() });
    await redis.sadd(INDEX, projectId);
  } catch {
    /* 무시 */
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
