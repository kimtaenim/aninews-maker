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
  // 음성(voiceover)은 영상(videos)과 독립적 — 나레이션 텍스트만 있으면 되므로,
  // 직전 단계(videos) 대신 키프레임(3단계) 승인만으로 시작할 수 있다(4단계와 동시 진행).
  if (step === "voiceover") {
    return project.steps.keyframe?.status === "approved";
  }
  const prev = STEP_ORDER[i - 1];
  return project.steps[prev]?.status === "approved";
}

/**
 * 그 단계의 산출물이 실제로 다 나왔는가? (status 와 별개로 "내용물" 기준)
 * 경합·부분 저장으로 status 가 generating 에 갇혀도, 이걸로 승인 가능 여부를 판정한다.
 * 주의: 씬0 은 keyframe 단계 산출물(스타일 앵커)이라 images/videos 완료 판정에서
 * 제외(씬1 이후만). 최종 합성(worker)도 videoUrl 있는 씬만 골라 굽는다.
 */
export function stepOutputsComplete(project: Project, step: StepKind): boolean {
  const scenes = project.scenes;
  const hasScenes = scenes.length > 0;
  switch (step) {
    case "source":
      return !!project.steps.source.params?.material;
    case "script":
      return hasScenes;
    case "keyframe":
      return !!project.keyframeUrl;
    case "images":
      return hasScenes && scenes.slice(1).every((s) => s.skipped || !!s.imageUrl);
    case "videos":
      return hasScenes && scenes.slice(1).every((s) => s.skipped || !!s.videoUrl);
    case "voiceover":
      return hasScenes && scenes.every((s) => s.skipped || !!s.audioUrl);
    case "compose":
    case "subtitle":
      return !!project.finalVideoUrl;
    default:
      return false;
  }
}

/** voiceover 처럼 끌 수 있는 선택 단계는 건너뛸 수 있다. */
export function isOptional(step: StepKind): boolean {
  return step === "voiceover";
}

export function nextStep(step: StepKind): StepKind | null {
  const i = STEP_ORDER.indexOf(step);
  return i >= 0 && i < STEP_ORDER.length - 1 ? STEP_ORDER[i + 1] : null;
}
