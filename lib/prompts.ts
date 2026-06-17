// ============================================================================
// 프롬프트 로더 — cardnews prompts.ts 의 {placeholder} 치환 패턴 (간소화)
// ----------------------------------------------------------------------------
// config/prompts.json 을 읽고, {style_bible}/{image_bible} 같은 변수를 호출 시
// 주입한다. 단계별 시스템 프롬프트는 getPrompt(step) 로 꺼낸다.
// ============================================================================

import promptsJson from "../config/prompts.json";

type PromptSection = { system: string; [k: string]: unknown };

export function getPrompt(step: keyof typeof promptsJson): PromptSection {
  const section = promptsJson[step] as PromptSection | undefined;
  if (!section || typeof section.system !== "string") {
    throw new Error(`prompt section not found: ${String(step)}`);
  }
  return section;
}

export function formatPrompt(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in vars ? String(vars[key]) : match
  );
}
