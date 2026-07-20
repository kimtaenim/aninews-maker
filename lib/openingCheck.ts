// ============================================================================
// 롱폼 오프닝 검사 — 로드맵 누출(고리 파괴) 감지 + 줄별 banned. 순수함수(테스트 대상).
// ----------------------------------------------------------------------------
// roadmap_leak = 목차/순서를 미리 보여줘 열린 고리를 닫아버리는 것. openingGen 의 재생성
// 판단과 scripts/test-opening-check.ts 가 쓴다. 판단형은 LLM self_check 가 1차, 이건 백스톱.
// ============================================================================

import { violatesBanned } from "./titleBanned";

// 로드맵/목차 노출 표현 감지 — 위반 이유 라벨 배열(빈 배열 = 없음).
export function detectRoadmapLeak(script: string[]): string[] {
  const t = (script ?? []).join(" ");
  const reasons: string[] = [];
  // 서수 나열: '첫 번째 … 두 번째' 동시 등장
  if (/첫\s*번째/.test(t) && /(두|둘|2)\s*번째/.test(t)) reasons.push("서수 나열");
  if (/차례로|순서대로|차근차근/.test(t)) reasons.push("순차 나열 표현");
  if (/정리해\s*(드리|줄|드릴|주겠|드릴게|줄게)/.test(t)) reasons.push("정리해드립니다형");
  if (/목차|리스트업/.test(t)) reasons.push("목차 노출");
  // 'X부터 Y까지 …알아/차례/정리/살펴' 식 훑기
  if (/부터[\s\S]{0,25}까지[\s\S]{0,20}(알아|차례|정리|살펴|보겠|보시)/.test(t)) reasons.push("X부터Y까지 훑기");
  return [...new Set(reasons)];
}

// 오프닝 전체 위반 — 로드맵 누출 + 줄별 banned(시점·수업예고·손실·물결표 등).
export function openingViolations(script: string[]): string[] {
  const v = [...detectRoadmapLeak(script)];
  for (const line of script ?? []) v.push(...violatesBanned(line));
  return [...new Set(v)];
}
