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
    '위 뉴스를 숏폼 영상용 "씬 배열"로 만들어줘. 각 씬은 나레이션만 만든다',
    "(이미지 프롬프트·모션은 다음 단계에서 따로 생성하므로 여기선 만들지 마). 반드시 다음 JSON 만 출력:",
    '{"scenes":[{"narration":"..."}]}',
    "narration 은 한국어 구어체, 한 씬에 한두 문장. 씬은 5~8개 정도로 자연스럽게 나눠.",
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

// ── 연애 클리셰 스크립트 (ani-cliché 모드) ───────────────────────────────────
// 트로프(벽치기·심쿵…) → 두 주인공(A·B)의 미니 러브스토리 5~6씬(대사+화자). 뉴스 경로와
// 완전히 분리된 함수라 뉴스 생성엔 영향 없음. 파서는 speaker 만 추가돼 공유(parseScenes).
export async function generateClicheScript(args: {
  projectId: string;
  tropes: string[]; // 고른 클리셰(자유 입력 포함)
  styleBible: string;
  userPrompt?: string;
}): Promise<{ scenes: Scene[]; costUsd: number }> {
  const { projectId, tropes, styleBible, userPrompt } = args;
  const client = getAnthropic();
  const section = getPrompt("script_cliche");
  const system = formatPrompt(section.system, { style_bible: styleBible });
  const max_tokens = typeof section.max_tokens === "number" ? section.max_tokens : 4000;

  const userMsg = [
    userPrompt ? `추가 지시: ${userPrompt}\n` : "",
    `연애 클리셰(트로프): ${tropes.filter(Boolean).join(", ") || "설렘 가득한 로맨스"}`,
    "",
    "위 클리셰들을 엮어 두 주인공(A·B)의 미니 러브스토리 5~6씬으로 만들어줘.",
    '각 씬: narration(한국어, 짧은 한 줄 — 자막이자 소리내는 대사. 캐릭터면 오글거리는 클리셰 대사, 나레이터면 상황설명·독백),',
    'speaker("A"/"B"=그 주인공 대사, "내레이션"=나레이터. 대부분 대사로 하고 "내레이션" 1~2컷만 섞어),',
    'image_prompt(영어, 글로시 웹툰 로맨스 비주얼), motion(영어, MV 카메라워크), duration_sec(3~6).',
    '반드시 JSON 만: {"scenes":[{"narration":"...","speaker":"A","image_prompt":"...","motion":"...","duration_sec":4}]}',
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
    meta: { kind: "script-cliche" },
  });

  const scenes = parseScenes(raw);
  if (!scenes || scenes.length === 0) {
    throw new Error("클리셰 씬 배열 파싱 실패 — Claude 응답에서 JSON 을 못 찾았어요");
  }
  return { scenes, costUsd };
}
