// ============================================================================
// 씬 프롬프트 생성 — 이미지 프롬프트(한글, 3·4단계) / 모션(영문, 5단계)
// ----------------------------------------------------------------------------
// 2단계는 나레이션만 만든다. 모드(styleBible)·품질을 정한 뒤 3·4단계에서 한글
// 이미지 프롬프트를, 5단계에서 영문 모션을 생성한다. 한 번의 Claude 호출로 여러
// 씬을 묶어 처리(순서 유지). 검열 안전·차분/은유 규칙은 generateScript 와 동일.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";

export interface SceneInput {
  index: number;
  narration: string;
}

function textOf(content: Array<{ type: string; text?: string }>): string {
  return (content.filter((b) => b.type === "text") as Array<{ text: string }>)
    .map((b) => b.text)
    .join("")
    .trim();
}

function parseItems(raw: string, key: string): Map<number, string> {
  const out = new Map<number, string>();
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = (m ? JSON.parse(m[0]) : {}) as {
      items?: Array<{ index?: number; [k: string]: unknown }>;
    };
    for (const it of parsed.items ?? []) {
      if (typeof it.index === "number" && typeof it[key] === "string") {
        out.set(it.index, (it[key] as string).trim());
      }
    }
  } catch {
    /* 파싱 실패 시 빈 맵 */
  }
  return out;
}

async function recordCostBestEffort(projectId: string, r: { usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null } }, kind: string): Promise<number> {
  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.sonnet,
  });
  try {
    await recordCost({ projectId, vendor: "anthropic", model: MODELS.sonnet, costUsd, meta: { kind } });
  } catch {
    /* 무시 */
  }
  return costUsd;
}

// 3·4단계 — 씬별 한글 이미지 프롬프트(장면 내용). 아트 스타일은 styleBible 이 따로
// 입혀지므로 여기선 "무엇이 보이는지"만 한국어로 묘사한다.
export async function generateImagePrompts(args: {
  projectId: string;
  scenes: SceneInput[];
  styleBible: string;
}): Promise<{ prompts: Map<number, string>; costUsd: number }> {
  const scenes = (args.scenes ?? []).filter((s) => s?.narration?.trim());
  if (scenes.length === 0) return { prompts: new Map(), costUsd: 0 };

  const client = getAnthropic();
  const system =
    "You write Korean image-generation prompts for short-form video scenes. " +
    "The art style is applied separately (style bible below) — so describe ONLY the scene CONTENT in Korean: " +
    "what is visible, the subject, setting, composition. Calm, censorship-safe, metaphorical everyday visuals — " +
    "avoid protests, raised fists, marching crowds, violence, weapons, blood, political slogans/symbols, real public figures. " +
    "Keep on-image text minimal. One scene = one concise Korean prompt. " +
    'Output ONLY JSON: {"items":[{"index":0,"prompt":"..."}]} with the SAME indices, one per scene.';
  // 모델이 임의 인덱스를 0-based 로 다시 매기는 일이 있어, 입력은 0..N-1 위치로 주고
  // 결과를 위치→원래 index 로 되매핑한다.
  const userMsg = [
    `Style bible (art style, for context only):\n${args.styleBible}`,
    "",
    "씬별 나레이션 (번호는 그대로 유지해서 응답):",
    ...scenes.map((s, pos) => `[${pos}] ${s.narration}`),
    "",
    'JSON 만: {"items":[{"index":0,"prompt":"한국어 이미지 프롬프트"}]} — index 는 위 [번호] 그대로.',
  ].join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const costUsd = await recordCostBestEffort(args.projectId, r, "image-prompt");
  const byPos = parseItems(textOf(r.content), "prompt");
  const prompts = new Map<number, string>();
  scenes.forEach((s, pos) => {
    const v = byPos.get(pos);
    if (v) prompts.set(s.index, v);
  });
  return { prompts, costUsd };
}

// 5단계 — 씬별 영문 모션 프롬프트. 카메라 워크 + 조명 변화 + (선택) 인물의 가벼운
// 미세 움직임만 지정한다. 정지 이미지는 이미 완성돼 있으므로 큰 동작/새 요소는 이미지와
// 어긋난다 → 카메라·조명에 더해 숨쉬기·머리카락 흔들림 정도의 잔잔한 움직임만 허용.
export async function generateMotions(args: {
  projectId: string;
  scenes: SceneInput[];
}): Promise<{ motions: Map<number, string>; costUsd: number }> {
  const scenes = (args.scenes ?? []).filter((s) => s?.narration?.trim());
  if (scenes.length === 0) return { motions: new Map(), costUsd: 0 };

  const client = getAnthropic();
  const system =
    "You write short English MOTION prompts for an image-to-video model. " +
    "The still image is ALREADY fully composed — never invent new elements or new people, never add big or " +
    "fast actions, and do not change what the scene depicts. Specify camera work, a lighting change, and " +
    "optionally a very subtle subject movement:\n" +
    "- Camera (pick ONE that fits the mood): slow zoom in, slow zoom out, pan left, pan right, tilt up, " +
    "tilt down, dolly / track in, track out, push-in, pull-back, full 360-degree orbit around the subject, " +
    "gentle handheld drift.\n" +
    "- Lighting (optional, only if it suits): gradually brightens, slowly darkens, shifts to dramatic " +
    "cinematic lighting, a light sweeps across the scene, light rotates around the subject.\n" +
    "- Subject (optional): only a slight, natural micro-movement — e.g. gentle breathing, a small head tilt, " +
    "a soft blink, hair or clothing drifting in a light breeze. Keep it minimal; no walking, gestures, or new actions.\n" +
    "Use the narration ONLY to judge the mood — never describe its content. Keep it smooth and cinematic. " +
    'One scene = one short English line, e.g. "Slow push-in, lighting shifts to dramatic side-light, subject breathing gently" ' +
    'or "Full 360-degree orbit around the subject, hair drifting softly". ' +
    'Output ONLY JSON: {"items":[{"index":0,"motion":"..."}]} with the SAME indices, one per scene.';
  const userMsg = [
    "씬별 나레이션 (분위기 참고용 — 내용은 묘사하지 말고, 어울리는 카메라 워크·조명·인물의 가벼운 미세 움직임만 고르세요. 번호 유지):",
    ...scenes.map((s, pos) => `[${pos}] ${s.narration}`),
    "",
    'JSON only: {"items":[{"index":0,"motion":"camera work + lighting only, in English"}]} — keep the [number] as index.',
  ].join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const costUsd = await recordCostBestEffort(args.projectId, r, "motion");
  const byPos = parseItems(textOf(r.content), "motion");
  const motions = new Map<number, string>();
  scenes.forEach((s, pos) => {
    const v = byPos.get(pos);
    if (v) motions.set(s.index, v);
  });
  return { motions, costUsd };
}
