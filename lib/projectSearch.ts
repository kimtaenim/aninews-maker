// ============================================================================
// 프로젝트 검색 — 라이브러리와 롱폼 묶기가 같은 규칙을 쓰도록 한 곳에 둔다.
// ----------------------------------------------------------------------------
// 제목 + 씬 나레이션(=스크립트)을 합친 건초더미에 키워드(공백 분리)가 "전부" 들어있는
// 프로젝트만 매칭(단순 부분일치, 대소문자 무시).
// ============================================================================

import type { Project } from "./types";

export function searchTerms(q: string): string[] {
  return (q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function matchesQuery(p: Project, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const hay = (p.title + " " + (p.scenes ?? []).map((s) => s.narration).join(" ")).toLowerCase();
  return terms.every((t) => hay.includes(t));
}

// 롱폼(세그먼트 참조 가로 프로젝트) 여부 — 일반 목록에서 제외(롱폼 탭에서 관리).
export function isLongform(p: Project): boolean {
  return p.format === "long" && Array.isArray(p.sourceProjectIds) && p.sourceProjectIds.length > 0;
}

// 롱폼 묶기 후보 — 완성본(finalVideoUrl)이 있는 세로 숏폼만(가로판·롱폼·세그먼트 제외).
export function isBundleCandidate(p: Project): boolean {
  return p.format !== "long" && !p.longformId && !!p.finalVideoUrl;
}
