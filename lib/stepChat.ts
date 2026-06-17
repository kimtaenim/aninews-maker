// ============================================================================
// StepChat — 단계별 Claude 미세조정 (골격)
// ----------------------------------------------------------------------------
// 흐름: 사용자 자연어 수정 요청 → Claude 가 의도 해석 → 그 단계의 params/프롬프트
// 패치 생성 → (rerun=true 면) 해당 단계 API 재호출. 씬 단위(scene)도 가능.
// 여기선 요청/응답 계약만 정의. 실제 Claude 호출·패치 적용은 채워간다.
// ============================================================================

import type { StepKind } from "./types";

export interface StepChatRequest {
  projectId: string;
  step: StepKind;
  sceneIndex?: number; // 씬 단위 미세조정
  userMessage: string; // 예: "민트색 빼고 더 차분하게"
  currentParams: Record<string, unknown>;
}

export interface StepChatResult {
  reply: string; // 사용자에게 보일 설명
  patchedParams: Record<string, unknown>; // 갱신된 파라미터
  rerun: boolean; // true 면 해당 단계 API 재호출
  rerunScope: "step" | "scene";
}

// TODO: runStepChat(req) → StepChatResult
//   step 별 시스템 프롬프트(config/prompts.json)를 골라 Claude 에 현재 params +
//   userMessage 전달, tool/JSON 으로 patchedParams 받음.
export async function runStepChat(
  _req: StepChatRequest
): Promise<StepChatResult> {
  throw new Error("not implemented");
}
