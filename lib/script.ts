// ============================================================================
// 스크립트 생성 (2단계) — Claude 가 소스에서 씬 배열 생성
// ----------------------------------------------------------------------------
// style_bible(스타일 프로필 image_bible) 을 주입해 전 씬이 한 결을 공유하게 한다.
// 5초는 평균 리듬 목표이지 하드락이 아니다 — 씬은 4~7초로 숨쉬게.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { getPrompt, formatPrompt } from "./prompts";
import { parseScenes, parseClicheScenes } from "./scenes";
import { anthropicCostUsd, recordCost } from "./cost";
import { EMOTIONS } from "./emotions";
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
  cast?: string[]; // 등장 인물 이름 — 화자(speaker)로 사용. 없으면 A/B.
}): Promise<{ scenes: Scene[]; costUsd: number }> {
  const { projectId, tropes, styleBible, userPrompt, cast } = args;
  const client = getAnthropic();
  const section = getPrompt("script_cliche");
  const system = formatPrompt(section.system, { style_bible: styleBible });
  const max_tokens = typeof section.max_tokens === "number" ? section.max_tokens : 4000;

  const userMsg = [
    userPrompt ? `추가 지시: ${userPrompt}\n` : "",
    `연애 클리셰(트로프): ${tropes.filter(Boolean).join(", ") || "설렘 가득한 로맨스"}`,
    "",
    cast && cast.length
      ? `등장 인물(이 이름들을 speaker 로 그대로 써): ${cast.join(", ")}`
      : "",
    "위 클리셰들을 엮어 주인공들의 미니 러브스토리 5~7씬으로 만들어줘.",
    "각 씬은 lines 배열(그 씬에서 나오는 대사·내레이션 줄들, 순서대로). 한 씬에 내레이션 줄 +",
    "대사 여러 줄을 섞어도 됨(예: 내레이션 한 줄 뒤 두 인물이 티키타카).",
    "각 줄: text(한국어 한 줄 — 대사면 오글거리는 클리셰, 내레이터면 상황설명·독백),",
    cast && cast.length
      ? `speaker(대사면 인물 이름 "${cast.join('"/"')}" 중 하나, 내레이션이면 "내레이션"),`
      : 'speaker(대사면 주인공 이름/"A"/"B", 내레이션이면 "내레이션"),',
    // 감정 id 목록은 lib/emotions.ts 단일 원천에서 파생(추가·삭제 자동 반영).
    `emotion(선택, 대사 감정 — 갈등·오열·고함도 적극 활용: ${EMOTIONS.map(
      (e) => `${e.id}=${e.label.split(" ").slice(1).join(" ") || e.label}`
    ).join("/")}).`,
    "무대사 '분위기 씬'도 1~2개 끼워도 좋아(비 오는 창밖, 노을 하늘, 스치는 손끝 클로즈업 같은",
    '감성 인서트): {"mood":true,"narration":"분위기 묘사(한국어)","lines":[]} — 이 씬은 더빙·자막 없이',
    "영상과 효과음만 나간다. 리듬상 전환점(고백 직전, 시간 경과)에 넣으면 좋다.",
    "duration_sec(3~8)도 씬마다. 이미지 프롬프트·카메라 모션은 여기서 만들지 마 —",
    "다음 단계에서 따로 생성한다(대사·분위기에만 집중).",
    '반드시 JSON 만: {"scenes":[{"lines":[{"text":"...","speaker":"내레이션"},{"text":"...","speaker":"' +
      (cast && cast[0] ? cast[0] : "지훈") +
      '","emotion":"throb"}],"duration_sec":5},' +
      '{"mood":true,"narration":"노을이 지는 옥상, 바람에 흔들리는 머리칼","lines":[],"duration_sec":4}]}',
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

  const scenes = parseClicheScenes(raw);
  if (!scenes || scenes.length === 0) {
    throw new Error("클리셰 씬 배열 파싱 실패 — Claude 응답에서 JSON 을 못 찾았어요");
  }
  return { scenes, costUsd };
}
