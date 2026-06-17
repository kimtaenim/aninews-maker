// ============================================================================
// 단계 상태머신 (골격)
// ----------------------------------------------------------------------------
// 규칙:
//   - 각 단계는 pending → generating → generated → approved 로 전이.
//   - 어떤 단계는 직전 단계가 approved 여야 generating 으로 진입 가능.
//   - 씬 단위 리롤은 해당 단계를 approved → generated 로 되돌린다.
//   - error 는 어느 상태에서든 진입 가능, 재시도로 generating 복귀.
// 전이 부수효과(API 호출, worker enqueue)는 여기 두지 않는다 — 순수 규칙만.
// ============================================================================

import { STEP_ORDER, type StepKind, type StepStatus, type Project } from "./types";

const ALLOWED: Record<StepStatus, StepStatus[]> = {
  pending: ["generating", "error"],
  generating: ["generated", "error"],
  generated: ["generating", "approved", "error"], // 재생성(리롤) 허용
  approved: ["generated", "generating"], // 되돌려 수정 허용
  error: ["generating", "pending"],
};

export function canTransition(from: StepStatus, to: StepStatus): boolean {
  return ALLOWED[from]?.includes(to) ?? false;
}

/** 직전 단계가 approved 여야 이 단계를 시작할 수 있다(첫 단계 source 는 예외). */
export function canStart(project: Project, step: StepKind): boolean {
  const i = STEP_ORDER.indexOf(step);
  if (i <= 0) return true;
  const prev = STEP_ORDER[i - 1];
  return project.steps[prev]?.status === "approved";
}

/** voiceover 처럼 끌 수 있는 선택 단계는 건너뛸 수 있다. */
export function isOptional(step: StepKind): boolean {
  return step === "voiceover";
}

export function nextStep(step: StepKind): StepKind | null {
  const i = STEP_ORDER.indexOf(step);
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : null;
}
