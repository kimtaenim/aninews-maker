// ============================================================================
// 제목 생성 로그 — 후보 전체·추천·최종 선택 제목을 저장(추후 조회수 성과와 조인해 프롬프트 개선).
// ----------------------------------------------------------------------------
// titlelog:<projectId> 에 로그 1건, titlelog:ids 셋에 projectId 를 모은다(열람용).
// 실패는 조용히 무시한다 — 로깅이 제목 생성/저장을 막지 않게.
// ============================================================================

import { getRedis } from "./redis";
import type { TitleResult } from "./titleGen";

const KEY = (id: string) => `titlelog:${id}`;
const INDEX = "titlelog:ids";

export interface TitleLog {
  projectId: string;
  candidates: TitleResult["candidates"];
  recommendedIndex: number;
  recommendReason: string;
  seoKeywords: string[];
  generatedAt: number;
  selectedTitle?: string; // 사용자가 최종 선택·수정한 제목
  selectedAt?: number;
}

export async function saveTitleGenLog(projectId: string, r: TitleResult): Promise<void> {
  try {
    const redis = getRedis();
    const log: TitleLog = {
      projectId,
      candidates: r.candidates,
      recommendedIndex: r.recommended_index,
      recommendReason: r.recommend_reason,
      seoKeywords: r.seo_keywords,
      generatedAt: Date.now(),
    };
    await redis.set(KEY(projectId), log);
    await redis.sadd(INDEX, projectId);
  } catch {
    /* 로깅 실패 무시 */
  }
}

// 최종 선택/수정된 제목 기록 — 생성 로그가 있을 때만(수동 제목 변경은 기록 안 함).
export async function setTitleSelected(projectId: string, title: string): Promise<void> {
  try {
    const redis = getRedis();
    const cur = (await redis.get<TitleLog>(KEY(projectId))) ?? null;
    if (!cur) return;
    cur.selectedTitle = title;
    cur.selectedAt = Date.now();
    await redis.set(KEY(projectId), cur);
  } catch {
    /* 무시 */
  }
}
