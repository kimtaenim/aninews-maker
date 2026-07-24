// ============================================================================
// [2단계 대본] 고정 프롬프트 버튼 — 본문은 config/script-buttons.json 단일 원천.
// ----------------------------------------------------------------------------
//  · 고리 정렬·간결화: 형식만 다듬는다(내용 불변). 기존 대본 대화 경로(runScriptChat)로 실행.
//  · 비판 검수: 내용을 의심한다. 웹 검색으로 반대편 사실을 찾아 2부 리포트를 낸다(자동 반영 없음).
// ============================================================================

import buttons from "../config/script-buttons.json";

export const LOOP_ALIGN_PROMPT: string = buttons.loopAlign.prompt;
export const LOOP_ALIGN_LABEL: string = buttons.loopAlign.label;
export const CRITIQUE_PROMPT: string = buttons.critique.prompt;
export const CRITIQUE_LABEL: string = buttons.critique.label;
