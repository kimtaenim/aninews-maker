// ============================================================================
// 롱폼 진행자(호스트) 대본 생성 — Claude 가 세그먼트 스크립트를 읽고 오프닝·연결·마무리를 쓴다.
// ----------------------------------------------------------------------------
// 호스트 = 송곳니 안경 미소녀 + 머리·얼굴 없는 사족보행 로봇 콤비(config/eyecatch.json).
// 각 호스트 씬은 나레이션 + 이미지 프롬프트(마스코트가 진행하는 장면). 오프닝 첫 씬은 두
// 마스코트를 또렷이 잡는 확정샷(이게 키프레임=레퍼런스가 되어 이후 씬에 계속 주입된다).
// 결과는 "진행자 프로젝트"의 scenes[] 로 들어가 Studio 에서 세그먼트처럼 씬별 편집된다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import eyecatchConfig from "../config/eyecatch.json";

export interface HostSceneDraft {
  narration: string;
  imagePrompt: string;
}

export interface HostScriptResult {
  opening: HostSceneDraft[]; // 2~3(각 한 씬). 첫 씬 = 두 마스코트 확정샷.
  connectors: HostSceneDraft[]; // 세그먼트 사이 간격 수(= 세그먼트 수 - 1)
  closing: HostSceneDraft[]; // 1~2
  costUsd: number;
}

export async function generateHostScript(args: {
  projectId: string;
  segments: { title: string; narration: string }[];
  // [호응] 롱폼 오프닝이 선언한 열린 고리 — 있으면 연결은 이 고리 유지, 마무리는 이 고리 닫기로 쓴다.
  opening?: { question?: string; closesAt?: string; closingLineHint?: string } | null;
}): Promise<HostScriptResult> {
  const { projectId, segments, opening: openingLoop } = args;
  const n = segments.length;
  const gaps = Math.max(0, n - 1);
  const client = getAnthropic();
  const mascot = (eyecatchConfig as { description?: string }).description ?? "";

  const segList = segments
    .map((s, i) => `[${i + 1}] 제목: ${s.title}\n내용: ${s.narration}`)
    .join("\n\n");

  const system =
    "너는 여러 경제·뉴스 숏폼을 하나의 가로 롱폼으로 엮는 진행자(호스트) 대본 작가다. " +
    "진행자는 두 마스코트 콤비다:\n" +
    mascot +
    "\n밝고 친근한 한국어 구어체. 각 씬은 나레이션(한국어)과 image(영어 비주얼 프롬프트)를 갖는다. " +
    "image 는 두 마스코트가 화면에 나와 진행/리액션하는 장면을 묘사한다(밝은 팝 배경). " +
    "opening 의 첫 씬 image 는 두 마스코트를 또렷이 잡는 전신 확정샷으로 써라(이게 레퍼런스가 된다).";

  const userMsg = [
    `아래 숏폼 ${n}개를 순서대로 이어붙인 롱폼의 진행자 대본을 써줘.`,
    "",
    segList,
    "",
    openingLoop?.question?.trim()
      ? `이 롱폼 오프닝이 연 열린 고리: "${openingLoop.question}" (닫는 위치: ${openingLoop.closesAt || "마지막"}). connectors 는 이 고리를 유지하는 브리지로(단순 '다음은 X' 금지), closing 은 이 고리를 명시적으로 닫도록 써라${openingLoop.closingLineHint ? ` (닫는 힌트: ${openingLoop.closingLineHint})` : ""}.`
      : "",
    "만들 것(각 씬 = {narration, image}):",
    `- opening: 2~3씬. 전체 ${n}개 주제를 소개하고 기대감. 합쳐 10~15초. 첫 씬 image=두 마스코트 확정샷.`,
    `- connectors: 정확히 ${gaps}씬. i번째는 세그먼트 i→i+1 전환 한 문장("~잘 봤죠? 다음은 ~").`,
    "- closing: 1~2씬. 전체 정리 + 구독·좋아요 유도.",
    "",
    "반드시 이 JSON 만 출력(코드펜스·다른 말 없이):",
    '{"opening":[{"narration":"...","image":"..."}],"connectors":[{"narration":"...","image":"..."}],"closing":[{"narration":"...","image":"..."}]}',
  ].join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 3000,
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
  await recordCost({ projectId, vendor: "anthropic", model: MODELS.sonnet, costUsd, meta: { kind: "longform-host" } });

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("진행자 대본 파싱 실패 — Claude 응답에서 JSON 을 못 찾았어요");
  let parsed: { opening?: unknown; connectors?: unknown; closing?: unknown };
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    throw new Error("진행자 대본 JSON 파싱 실패");
  }
  const toDrafts = (v: unknown): HostSceneDraft[] =>
    (Array.isArray(v) ? v : [])
      .map((x) => {
        const o = (x ?? {}) as { narration?: unknown; image?: unknown };
        const narration = typeof o.narration === "string" ? o.narration.trim() : "";
        const imagePrompt = typeof o.image === "string" ? o.image.trim() : "";
        return { narration, imagePrompt };
      })
      .filter((d) => d.narration.length > 0);

  const opening = toDrafts(parsed.opening);
  let connectors = toDrafts(parsed.connectors);
  const closing = toDrafts(parsed.closing);
  if (connectors.length > gaps) connectors = connectors.slice(0, gaps);
  while (connectors.length < gaps) {
    connectors.push({ narration: "다음 이야기로 넘어가 볼까요?", imagePrompt: "The two host mascots cheerfully gesturing toward the next topic, bright pop background." });
  }

  if (opening.length === 0 && closing.length === 0) {
    throw new Error("진행자 대본이 비어 있어요 — 다시 시도해 주세요");
  }
  return { opening, connectors, closing, costUsd };
}
