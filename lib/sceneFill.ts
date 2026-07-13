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

// items 배열을 "순서대로" 파싱한다 — 모델이 index 필드를 빠뜨리거나 엉뚱하게(1-based·
// 원래 씬번호 등) 매겨도, 응답 순서 = 입력 순서로 안전하게 매핑하기 위함.
function parseItemsOrdered(raw: string, key: string): string[] {
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    const parsed = (m ? JSON.parse(m[0]) : {}) as { items?: Array<Record<string, unknown>> };
    const items = Array.isArray(parsed.items) ? parsed.items : [];
    return items.map((it) => (typeof it?.[key] === "string" ? (it[key] as string).trim() : ""));
  } catch {
    return []; // 파싱 실패 → 빈 배열
  }
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
  mode?: "news" | "cliche"; // cliche 면 로맨스 클리셰 연출(같은 두 주인공·과장 리액션)로
}): Promise<{ prompts: Map<number, string>; costUsd: number; raw: string }> {
  const scenes = (args.scenes ?? []).filter((s) => s?.narration?.trim());
  if (scenes.length === 0) return { prompts: new Map(), costUsd: 0, raw: "" };

  const client = getAnthropic();
  // [cliche] 대사(줄들)를 보고 로맨스 클리셰 비주얼을 설계 — 같은 두 주인공이 전 씬 이어지고,
  // 감정 비트가 화면에 보이게(과장 리액션). 분위기 씬(무대사)은 감성 정경 인서트로.
  const system =
    args.mode === "cliche"
      ? "You write Korean image-generation prompts for a glossy Korean romance-cliché short (ani-cliché). " +
        "The art style is applied separately (style bible below) — describe ONLY the scene CONTENT in Korean. " +
        "Scenes are over-the-top romance-cliché beats (벽치기, 심쿵 눈맞춤, 우산, 고백…): keep the SAME two lead " +
        "characters consistent across every scene (같은 남주·여주 — 머리 모양·복장이 씬마다 이어짐), staged like a " +
        "romance webtoon: 밀착 구도, 눈맞춤, 얼굴 클로즈업, 설레는 거리감, 역광·보케 같은 분위기 요소. " +
        "대사가 주어진 씬은 그 감정 비트가 화면에 보이게(커진 눈, 붉어진 볼, 심장 부여잡기 같은 과장 리액션). " +
        "무대사 분위기 씬(대사 없이 분위기 묘사만 주어진 씬)은 인물 없이 또는 뒷모습·손끝만으로 감성 정경을 " +
        "묘사(비 내리는 창, 노을 하늘, 스치는 손끝). Never a photoreal likeness of a real person. " +
        "Keep on-image text minimal. Keep EACH prompt SHORT — one concise Korean sentence, roughly under 60 Korean " +
        "characters (각 프롬프트는 한 문장·60자 내외로 짧게). " +
        'Output ONLY JSON: {"items":[{"index":0,"prompt":"..."}]} with the SAME indices, one per scene.'
      : "You write Korean image-generation prompts for short-form video scenes. " +
        "The art style is applied separately (style bible below) — so describe ONLY the scene CONTENT in Korean: " +
        "what is visible, the subject, setting, composition. Calm, censorship-safe, metaphorical everyday visuals — " +
        "avoid protests, raised fists, marching crowds, violence, weapons, blood, political slogans/symbols, real public figures. " +
        "Write ONE natural scene as plain prose and compose it freely — camera angle, framing and subject size are " +
        "entirely up to you (하나의 자연스러운 장면을 자유롭게 묘사 — 카메라·프레이밍·인물 크기는 자유). " +
        "Keep on-image text minimal. Keep EACH prompt SHORT — one concise Korean sentence, roughly under 60 Korean " +
        "characters; describe only the essentials, do NOT over-describe (각 프롬프트는 한 문장·60자 내외로 짧게). " +
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
    max_tokens: 4000, // 씬이 많으면 2000 에서 JSON 이 잘려 파싱 실패 → 여유 상향
    system,
    messages: [{ role: "user", content: userMsg }],
  });
  const costUsd = await recordCostBestEffort(args.projectId, r, "image-prompt");
  const raw = textOf(r.content);
  const ordered = parseItemsOrdered(raw, "prompt");
  const prompts = new Map<number, string>();
  scenes.forEach((s, pos) => {
    const v = ordered[pos];
    if (v) prompts.set(s.index, v);
  });
  if (prompts.size === 0) {
    console.warn("[image-prompts] 파싱 0개 — 모델 원문 앞부분:", raw.slice(0, 500));
  }
  return { prompts, costUsd, raw };
}

// 5단계 — 씬별 영문 모션 프롬프트. 카메라 워크 + 조명 변화 + (선택) 인물의 가벼운
// 미세 움직임. 정지 이미지가 이미 완성돼 있으니 움직임은 가볍고 자연스럽게 유지한다.
export async function generateMotions(args: {
  projectId: string;
  scenes: SceneInput[];
  mode?: "news" | "cliche"; // cliche 면 잔잔한 카메라 대신 뮤직비디오 카메라워크
}): Promise<{ motions: Map<number, string>; costUsd: number }> {
  const scenes = (args.scenes ?? []).filter((s) => s?.narration?.trim());
  if (scenes.length === 0) return { motions: new Map(), costUsd: 0 };

  const client = getAnthropic();
  // [cliche] 무조건 스타일리시한 MV 카메라 — 속도 변화는 영어로 명시(i2v 가 알아듣게),
  // 피사체는 거의 정지하고 카메라가 드라마를 만든다. (기본 news 프롬프트는 잔잔·자연스럽게.)
  const system =
    args.mode === "cliche"
      ? "You write short English MOTION prompts for an image-to-video model, for a glossy Korean romance " +
        "MUSIC VIDEO. Every scene must feel STYLISH and cinematic — never plain, never static:\n" +
        "- Camera (pick ONE bold move per scene, VARY across scenes): fast push-in slamming into a face " +
        "close-up, crash zoom, speed-ramped dolly (dreamy slow motion that SNAPS into a violently fast " +
        "rush), whip pan with heavy motion blur then a hard stop, full sweeping orbit like a luxury " +
        "perfume commercial, dolly-zoom vertigo (background warps and stretches), rack focus snapping " +
        "onto the glistening eyes.\n" +
        "- Always state how the FRAMING changes from first frame to last (e.g. 'starts medium, ends in " +
        "an extreme close-up on the eyes') and spell out SPEED changes explicitly ('begins in dreamy " +
        "slow motion, then suddenly accelerates').\n" +
        "- The subject may move too: hair and clothes whipping in wind, a head turn, a step toward " +
        "camera. NEVER write 'subject stays still', 'camera only', 'gentle', 'subtle' or 'slightly' — " +
        "those words make the shot timid. Add glossy MV dressing where it fits: lens bloom, sparkles, " +
        "a dramatic backlight sweep.\n" +
        "Use the lines only to judge the emotional beat (심쿵 → crash zoom / rack focus; 애틋 → " +
        "slow-motion glamour / orbit; 갈등 → whip pan / vertigo). " +
        'One scene = one short English line, e.g. "Speed-ramped dolly-in: dreamy slow motion, then a ' +
        "violently fast rush ending in an extreme close-up on her glistening eyes, hair whipping, lens " +
        'bloom flaring". ' +
        'Output ONLY JSON: {"items":[{"index":0,"motion":"..."}]} with the SAME indices, one per scene.'
      : "You write short English MOTION prompts for an image-to-video model. " +
        "The still image is already composed, so keep the movement light and natural — focus on camera work and " +
        "lighting, with a touch of gentle subject motion that fits the image:\n" +
        "- Camera (pick one that fits the mood): slow zoom in, slow zoom out, pan left, pan right, tilt up, " +
        "tilt down, dolly / track in, track out, push-in, pull-back, full 360-degree orbit around the subject, " +
        "gentle handheld drift.\n" +
        "- Lighting (optional): gradually brightens, slowly darkens, shifts to dramatic " +
        "cinematic lighting, a light sweeps across the scene, light rotates around the subject.\n" +
        "- Subject (optional): a slight, natural micro-movement such as gentle breathing, a small head tilt, " +
        "a soft blink, or hair / clothing drifting in a light breeze.\n" +
        "Use the narration only to judge the mood. Keep it smooth and cinematic. " +
        'One scene = one short English line, e.g. "Slow push-in, lighting shifts to dramatic side-light, subject breathing gently" ' +
        'or "Full 360-degree orbit around the subject, hair drifting softly". ' +
        'Output ONLY JSON: {"items":[{"index":0,"motion":"..."}]} with the SAME indices, one per scene.';
  const userMsg = [
    args.mode === "cliche"
      ? "씬별 대사/나레이션 (감정 비트 참고용 — 씬마다 다른 볼드한 MV 카메라 무브를 고르세요. 번호 유지):"
      : "씬별 나레이션 (분위기 참고용 — 내용은 묘사하지 말고, 어울리는 카메라 워크·조명·인물의 가벼운 미세 움직임만 고르세요. 번호 유지):",
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
  const ordered = parseItemsOrdered(textOf(r.content), "motion");
  const motions = new Map<number, string>();
  scenes.forEach((s, pos) => {
    const v = ordered[pos];
    if (v) motions.set(s.index, v);
  });
  return { motions, costUsd };
}
