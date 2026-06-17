// ============================================================================
// 스크립트 생성 (2단계) — Claude 가 소스에서 씬 배열 생성
// ----------------------------------------------------------------------------
// style_bible(스타일 프로필 image_bible) 을 주입해 전 씬이 한 결을 공유하게 한다.
// 5초는 평균 리듬 목표이지 하드락이 아니다 — 씬은 4~7초로 숨쉬게.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { getPrompt, formatPrompt } from "./prompts";
import { parseScenes } from "./scenes";
import { anthropicCostUsd, recordCost } from "./cost";
import type { Scene } from "./types";
import type { SourceMaterial } from "./source";

export interface GenerateScriptArgs {
  projectId: string;
  material: SourceMaterial;
  styleBible: string;
  userPrompt?: string; // StepChat 등에서 온 추가 지시
}

export async function generateScript(
  args: GenerateScriptArgs
): Promise<{ scenes: Scene[]; costUsd: number }> {
  const { projectId, material, styleBible, userPrompt } = args;
  const client = getAnthropic();
  const section = getPrompt("script");

  const system = formatPrompt(section.system, { style_bible: styleBible });
  const max_tokens =
    typeof section.max_tokens === "number" ? section.max_tokens : 4000;

  const userMsg = [
    userPrompt ? `추가 지시: ${userPrompt}\n` : "",
    `제목: ${material.title}`,
    material.sourceName ? `출처: ${material.sourceName}` : "",
    "",
    "본문:",
    material.body,
    "",
    '위 뉴스를 숏폼 영상용 "씬 배열"로 만들어줘. 반드시 다음 JSON 만 출력:',
    '{"scenes":[{"narration":"...","image_prompt":"...","motion":"...","duration_sec":5}]}',
    "narration 은 한국어 구어체, image_prompt 와 motion 은 영어. duration_sec 은 4~7.",
  ]
    .filter(Boolean)
    .join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const textBlocks = r.content.filter(
    (b: { type: string }) => b.type === "text"
  ) as Array<{ type: "text"; text: string }>;
  const raw = textBlocks.map((b) => b.text).join("").trim();

  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.sonnet,
  });
  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd,
    meta: { kind: "script" },
  });

  const scenes = parseScenes(raw);
  if (!scenes || scenes.length === 0) {
    throw new Error("씬 배열 파싱 실패 — Claude 응답에서 JSON 을 못 찾았어요");
  }
  return { scenes, costUsd };
}
