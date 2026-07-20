// ============================================================================
// 롱폼 오프닝 생성 로그 — 입력 구성·생성 결과·최종 채택본 저장(추후 시청 지속곡선과 조인).
// ----------------------------------------------------------------------------
// openinglog:<projectId> 에 1건, openinglog:ids 셋에 projectId. 실패는 조용히 무시.
// ============================================================================

import { getRedis } from "./redis";
import type { OpeningGenResult } from "./openingGen";

const KEY = (id: string) => `openinglog:${id}`;
const INDEX = "openinglog:ids";

export async function saveOpeningLog(
  projectId: string,
  topic: string,
  chapters: { title: string; summary: string }[],
  result: OpeningGenResult
): Promise<void> {
  try {
    const redis = getRedis();
    await redis.set(KEY(projectId), {
      projectId,
      topic,
      chapters,
      result,
      generatedAt: Date.now(),
    });
    await redis.sadd(INDEX, projectId);
  } catch {
    /* 무시 */
  }
}

// 최종 채택(수정)된 오프닝 스크립트 기록 — 생성 로그가 있을 때만.
export async function setOpeningFinal(projectId: string, script: string[]): Promise<void> {
  try {
    const redis = getRedis();
    const cur = (await redis.get<Record<string, unknown>>(KEY(projectId))) ?? null;
    if (!cur) return;
    cur.finalScript = script;
    cur.finalAt = Date.now();
    await redis.set(KEY(projectId), cur);
  } catch {
    /* 무시 */
  }
}
