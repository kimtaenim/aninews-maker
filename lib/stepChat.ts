// ============================================================================
// StepChat — 단계별 Claude 미세조정 (키프레임부터 구현)
// ----------------------------------------------------------------------------
// 사용자 자연어 수정 요청 → Claude 가 그 단계의 파라미터(키프레임은 style bible)를
// 갱신 → 호출부가 저장하고 해당 단계 재생성. 다른 단계도 같은 패턴으로 확장.
// ============================================================================

import type Anthropic from "@anthropic-ai/sdk";
import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import type { SourceMaterial } from "./source";

// ── 팩트체크 (2단계) — 씬 나레이션의 사실관계를 웹 검색으로 검증한다 ──────────────
// 소스를 "정답"으로 놓고 대조만 하면 소스가 틀렸을 때 그대로 통과된다 → web_search 도구로
// 실제 사실을 확인한다. 소스는 초안 근거(그 자체도 검증 대상)로만 넘긴다. 씬을 고치지는
// 않고(리포트만), 고치기는 대화창에서 runScriptChat 으로 이어간다. 양질 모델(opus).
// Anthropic 웹 검색 요금: 1,000회당 $10 (= 1회 $0.01).
const WEB_SEARCH_USD_PER_CALL = 0.01;

export async function runFactCheck(args: {
  projectId: string;
  narrations: string[];
  material?: SourceMaterial;
}): Promise<{ reply: string; costUsd: number }> {
  const { projectId, narrations, material } = args;
  const client = getAnthropic();

  const system =
    "You are a fact-checker for a short-form Korean news video script. You have a web_search tool — USE IT to " +
    "verify the script's claims against current, reputable real-world sources. Do NOT rely only on the provided " +
    "draft source: it is just what the script was drafted from and may itself be outdated, biased, or wrong — " +
    "treat it as a claim to check, not ground truth. For each scene, search the web to confirm names, numbers, " +
    "dates, quotes and events against up-to-date sources, and flag anything the script gets wrong, exaggerates, " +
    "or that cannot be verified. Search in Korean or English as fits the topic. " +
    "Reply in KOREAN as a concise, scannable report: for each problem cite the scene number (씬 N), quote the " +
    "issue briefly, state what the web sources actually say (name the outlet/source), and suggest the fix. If a " +
    "claim checks out, don't list it. If you genuinely can't verify something after searching, say so explicitly " +
    "(미확인). End with one line telling the user they can ask you to apply any fix in this chat. " +
    "Do NOT rewrite the whole script here — this is a review, not an edit. Plain text, no JSON, no markdown headers.";

  const userMsg =
    (material
      ? `참고용 초안 소스 제목: ${material.title}\n\n참고용 초안 소스 본문(이 자체도 검증 대상 — 정답 아님):\n${material.body}\n\n`
      : "(초안 소스 없음 — 웹 검색으로만 검증)\n\n") +
    "검증할 스크립트 씬 나레이션:\n" +
    narrations.map((n, i) => `${i + 1}. ${n}`).join("\n");

  // 웹 검색 서버 도구. 검색 횟수 상한으로 비용/시간 폭주 방지.
  const tools = [
    // 웹 검색료·토큰 절감 위해 4회로 상한. Sonnet 4.6 은 최신(dynamic filtering) 변형 지원.
    { type: "web_search_20260209", name: "web_search", max_uses: 4 },
  ] as unknown as Anthropic.Messages.ToolUnion[];

  // 비용 절감: 팩트체크는 Sonnet(웹 검색 대조 작업엔 충분·Opus 대비 저렴). 모델 바꾸면
  // 웹 검색 변형 지원 여부 확인 필요(Sonnet 4.6/5·Opus 4.6+ 만 web_search_20260209 지원).
  const model = MODELS.sonnet;
  // 서버 도구 루프가 10회 반복 상한에 걸리면 stop_reason=pause_turn 으로 끊긴다 → 이어서 재요청.
  const messages: Anthropic.Messages.MessageParam[] = [{ role: "user", content: userMsg }];
  let costUsd = 0;
  let searches = 0;
  const textParts: string[] = [];
  for (let turn = 0; turn < 6; turn++) {
    const r = await client.messages.create({
      model,
      max_tokens: 6000,
      system,
      messages,
      tools,
    });
    costUsd += anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model,
    });
    searches +=
      (r.usage as { server_tool_use?: { web_search_requests?: number } }).server_tool_use
        ?.web_search_requests ?? 0;
    const t = textOf(r.content);
    if (t) textParts.push(t);
    if (r.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: r.content });
      continue;
    }
    break;
  }
  costUsd += searches * WEB_SEARCH_USD_PER_CALL;

  await recordCost({
    projectId,
    vendor: "anthropic",
    model,
    costUsd,
    meta: { kind: "factcheck", webSearches: searches },
  }).catch(() => {});

  const reply = textParts.join("\n\n").trim() || "팩트체크 결과를 받지 못했어요 — 다시 시도해 주세요.";
  return { reply, costUsd };
}

function parseJson(raw: string): { reply?: unknown; style_bible?: unknown } | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

// 키프레임 StepChat: style bible 을 사용자 요청대로 다듬는다.
export async function runKeyframeChat(args: {
  projectId: string;
  styleProfileLabel: string;
  currentStyleBible: string;
  userMessage: string;
}): Promise<{ reply: string; styleBible: string; costUsd: number }> {
  const { projectId, styleProfileLabel, currentStyleBible, userMessage } = args;
  const client = getAnthropic();

  const system =
    `You refine the visual STYLE BIBLE for a short-form (9:16 vertical) video keyframe ` +
    `generated by gpt-image-2. Style profile: "${styleProfileLabel}". The style bible is ` +
    `the English text that locks the art style, character design, color palette and ` +
    `composition for the whole video. Given the user's adjustment request (Korean), output ` +
    `an UPDATED style bible (English, concise, concrete, keep what the user didn't ask to ` +
    `change) and a short Korean reply summarizing what changed. Keep it 9:16 vertical and ` +
    `consistent with the profile. Return ONLY JSON: {"reply":"...","style_bible":"..."}`;

  const userMsg =
    `현재 style bible:\n${currentStyleBible}\n\n수정 요청: ${userMessage}`;

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 1500,
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
    meta: { kind: "stepchat-keyframe" },
  });

  const parsed = parseJson(raw);
  const styleBible =
    parsed && typeof parsed.style_bible === "string" && parsed.style_bible.trim()
      ? parsed.style_bible.trim()
      : currentStyleBible; // 파싱 실패 시 기존 유지
  const reply =
    parsed && typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "스타일을 갱신했어요.";

  return { reply, styleBible, costUsd };
}

// 1단계 소스 대화 — 사용자 요청대로 소스 자료(제목·본문)를 다듬는다. 강조·재작성·복수
// 소스 조합·톤/길이 조정 등. 좋은 모델(opus)로 양질의 컨텐츠를 뽑는다. 현재 자료를 항상
// 최신 상태로 넘기고, 갱신된 자료 + 한국어 요약 답변을 돌려준다.
function textOf(content: Array<{ type: string; text?: string }>): string {
  return (content.filter((b) => b.type === "text") as Array<{ text: string }>)
    .map((b) => b.text)
    .join("")
    .trim();
}

export async function runSourceChat(args: {
  projectId: string;
  material: SourceMaterial;
  userMessage: string;
}): Promise<{ reply: string; material: SourceMaterial; costUsd: number }> {
  const { projectId, material, userMessage } = args;
  const client = getAnthropic();

  const system =
    "You help a user refine the SOURCE material for a short-form Korean news video, BEFORE the script is " +
    "written. You are given the current title and body (Korean). Apply the user's request — rewrite parts, " +
    "emphasize a section, adjust tone/length, integrate or combine facts from multiple sources, fix errors — " +
    "and return the FULL updated material. Keep the body as ONE coherent Korean narrative (no markdown, no " +
    "bullet lists, no '소스1/2' labels). Preserve important facts and numbers unless asked to change them. " +
    "Aim for high-quality, engaging, accurate content. Also write a short Korean reply summarizing what changed. " +
    'Return ONLY JSON: {"reply":"...","title":"...","body":"..."}';

  const userMsg =
    `현재 소스 제목: ${material.title}\n\n현재 소스 본문:\n${material.body}\n\n요청: ${userMessage}`;

  const r = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = textOf(r.content);

  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.opus,
  });
  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.opus,
    costUsd,
    meta: { kind: "source-chat" },
  }).catch(() => {});

  let parsed: { reply?: unknown; title?: unknown; body?: unknown } = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    /* 파싱 실패 → 기존 자료 유지, 원문을 답변으로 */
  }
  const title =
    typeof parsed.title === "string" && parsed.title.trim() ? parsed.title.trim() : material.title;
  const body =
    typeof parsed.body === "string" && parsed.body.trim() ? parsed.body.trim() : material.body;
  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "반영했어요. 본문을 확인해 주세요.";

  return { reply, material: { ...material, title, body }, costUsd };
}

// 2단계 스크립트 대화 — 씬 나레이션들을 대화로 수정한다(재작성·분할/병합·추가/삭제·
// 순서·톤/훅). 좋은 모델(opus). 현재 나레이션 목록을 넘기고, 갱신된 나레이션 배열 +
// 한국어 요약 답변을 돌려준다. 이미지 프롬프트·모션은 여기서 만들지 않는다(다음 단계).
export async function runScriptChat(args: {
  projectId: string;
  narrations: string[];
  userMessage: string;
}): Promise<{ reply: string; narrations: string[]; costUsd: number }> {
  const { projectId, narrations, userMessage } = args;
  const client = getAnthropic();

  const system =
    "You help a user refine the SCRIPT of a short-form Korean news video. The script is a list of scene " +
    "narrations (Korean, spoken). Apply the user's request — reword, shorten or expand, split or merge scenes, " +
    "add or remove a scene, reorder, sharpen the hook, adjust tone — and return the FULL updated list of scene " +
    "narrations. Each narration is natural Korean speech (one or two short sentences) that works for both " +
    "voiceover and on-screen subtitles. Keep 5-9 scenes unless the user asks otherwise. Do NOT write image " +
    "prompts or motion — narration only. IMPORTANT: a narration may contain manual newlines (\\n) — these are " +
    "the user's on-screen SUBTITLE LINE BREAKS. Preserve every newline exactly where it is; do not remove, add, " +
    "or move them unless your edit changes that exact line. Keep newlines as real \\n inside the JSON strings. " +
    "Also write a short Korean reply summarizing what changed. " +
    'Return ONLY JSON: {"reply":"...","scenes":["나레이션1","나레이션2", ...]}';

  const userMsg =
    "현재 씬 나레이션:\n" +
    narrations.map((n, i) => `${i + 1}. ${n}`).join("\n") +
    `\n\n요청: ${userMessage}`;

  const r = await client.messages.create({
    model: MODELS.opus,
    max_tokens: 8000,
    system,
    messages: [{ role: "user", content: userMsg }],
  });

  const raw = textOf(r.content);
  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.opus,
  });
  await recordCost({
    projectId,
    vendor: "anthropic",
    model: MODELS.opus,
    costUsd,
    meta: { kind: "script-chat" },
  }).catch(() => {});

  let parsed: { reply?: unknown; scenes?: unknown } = {};
  try {
    const m = raw.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(m ? m[0] : raw);
  } catch {
    /* 파싱 실패 → 기존 유지 */
  }
  const nextList = Array.isArray(parsed.scenes)
    ? parsed.scenes.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean)
    : [];
  const next = nextList.length > 0 ? nextList : narrations;
  // 줄바꿈(수동 자막 경계) 보존 안전망: 씬 개수가 그대로고 그 씬 내용이 (공백·줄바꿈 무시)
  // 안 바뀌었으면 원본 나레이션을 유지해 사용자의 줄바꿈을 지킨다. 실제로 고쳐진 씬만
  // 모델 출력을 쓴다(그 씬은 내용이 달라졌으니 줄 조절이 필요할 수 있음). 개수가 바뀌면(분할·
  // 병합) index 정렬이 깨지므로 그대로 둔다.
  const norm = (s: string) => s.replace(/\s+/g, " ").trim();
  const preserved =
    next.length === narrations.length
      ? next.map((n, i) => (norm(n) === norm(narrations[i]) ? narrations[i] : n))
      : next;
  const reply =
    typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : "반영했어요. 씬을 확인해 주세요.";

  return { reply, narrations: preserved, costUsd };
}
