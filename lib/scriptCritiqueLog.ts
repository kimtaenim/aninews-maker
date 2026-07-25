// ============================================================================
// 비판 검수 결과 저장 — 체크박스 반영 목록을 새로고침 후에도 살려 둔다.
// ----------------------------------------------------------------------------
// critique:<projectId> 에 1건. 대본 지문을 함께 남겨, 검수 후 대본이 바뀌었으면
// "낡은 검수"로 표시한다(엉뚱한 씬에 반영되는 사고 방지). 실패는 조용히 무시.
// scriptReviewLog.ts 와 같은 구조 — 두 기능의 저장 규약을 일부러 맞춰 둔다.
// ============================================================================

import { getRedis } from "./redis";
import { reviewFingerprint } from "./scriptReview";
import type { CritiqueFix } from "./scriptCritique";

const KEY = (id: string) => `critique:${id}`;

export interface CritiqueLog {
  projectId: string;
  report: string;
  fixes: CritiqueFix[];
  verdict: string;
  searched: boolean;
  reviewedAt: number;
  fingerprint: string; // 검수 당시 대본 지문 — 최신 여부 판정용
  applied?: { ids: string[]; at: number };
}

export async function saveCritiqueLog(
  projectId: string,
  data: { report: string; fixes: CritiqueFix[]; verdict: string; searched: boolean },
  narrations: string[]
): Promise<void> {
  try {
    const log: CritiqueLog = {
      projectId,
      ...data,
      reviewedAt: Date.now(),
      fingerprint: reviewFingerprint(narrations),
    };
    await getRedis().set(KEY(projectId), log);
  } catch {
    /* 무시 */
  }
}

export async function getCritiqueLog(projectId: string): Promise<CritiqueLog | null> {
  try {
    return (await getRedis().get<CritiqueLog>(KEY(projectId))) ?? null;
  } catch {
    return null;
  }
}

// 어떤 항목을 반영했는지 기록 — 같은 항목을 두 번 반영하는 것을 UI 에서 막는 데 쓴다.
export async function setCritiqueApplied(projectId: string, ids: string[]): Promise<void> {
  try {
    const redis = getRedis();
    const cur = await redis.get<CritiqueLog>(KEY(projectId));
    if (!cur) return;
    const merged = Array.from(new Set([...(cur.applied?.ids ?? []), ...ids]));
    cur.applied = { ids: merged, at: Date.now() };
    await redis.set(KEY(projectId), cur);
  } catch {
    /* 무시 */
  }
}
