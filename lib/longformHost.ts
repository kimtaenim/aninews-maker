// ============================================================================
// 롱폼 진행자(호스트) 대본 생성 — Claude 가 세그먼트 스크립트를 읽고 오프닝·연결·마무리를 쓴다.
// ----------------------------------------------------------------------------
// 호스트 = 송곳니 안경 미소녀 + 머리·얼굴 없는 사족보행 로봇 콤비(config/eyecatch.json).
// 오프닝 첫 씬에서 이 캐릭터를 생성해 키프레임(레퍼런스)으로 삼고, 연결·마무리·썸네일에 계속 주입.
// 여기선 "나레이션"만 만든다(이미지 프롬프트·모션·이미지·영상·음성은 이후 파이프라인).
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";

export interface HostScriptResult {
  opening: string[]; // 오프닝 나레이션(2~3, 각 한 씬)
  connectors: string[]; // 연결 나레이션 — 세그먼트 사이 간격 수(= 세그먼트 수 - 1)
  closing: string[]; // 마무리 나레이션(1~2)
  costUsd: number;
}

export async function generateHostScript(args: {
  projectId: string;
  segments: { title: string; narration: string }[]; // 각 세그먼트의 합친 나레이션
}): Promise<HostScriptResult> {
  const { projectId, segments } = args;
  const n = segments.length;
  const gaps = Math.max(0, n - 1);
  const client = getAnthropic();

  const segList = segments
    .map((s, i) => `[${i + 1}] 제목: ${s.title}\n내용: ${s.narration}`)
    .join("\n\n");

  const system =
    "너는 여러 경제·뉴스 숏폼을 하나의 가로 롱폼으로 엮는 진행자(호스트) 대본 작가다. " +
    "진행자는 '송곳니 안경 미소녀' 마스코트와 '머리·얼굴 없는 사족보행 로봇' 콤비다. " +
    "밝고 친근한 한국어 구어체, 짧고 간결하게.";

  const userMsg = [
    `아래 숏폼 ${n}개를 순서대로 이어붙인 롱폼의 진행자 대본을 써줘.`,
    "",
    segList,
    "",
    "다음을 만들어(나레이션만, 한국어 구어체):",
    `- opening: 2~3개(각 한 씬, 한 문장). 전체 ${n}개 주제를 소개하고 기대감을 준다. 합쳐서 10~15초 분량.`,
    `- connectors: 정확히 ${gaps}개. i번째는 세그먼트 i에서 i+1로 자연스럽게 넘기는 한 문장(예: "환율 얘기 잘 봤죠? 다음은 밸류업이에요").`,
    "- closing: 1~2개. 전체를 짧게 정리하고 구독·좋아요를 유도한다.",
    "",
    "반드시 이 JSON 만 출력(다른 말·코드펜스 없이):",
    `{"opening":["문장","문장"],"connectors":[${gaps > 0 ? '"문장"' : ""}],"closing":["문장"]}`,
  ].join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 2000,
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
  const toList = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((s) => s.trim()) : [];

  const opening = toList(parsed.opening);
  let connectors = toList(parsed.connectors);
  const closing = toList(parsed.closing);
  // connectors 개수 보정 — 부족하면 일반 전환 문구로 채우고, 넘치면 자른다.
  if (connectors.length > gaps) connectors = connectors.slice(0, gaps);
  while (connectors.length < gaps) connectors.push("다음 이야기로 넘어가 볼까요?");

  if (opening.length === 0 && closing.length === 0) {
    throw new Error("진행자 대본이 비어 있어요 — 다시 시도해 주세요");
  }
  return { opening, connectors, closing, costUsd };
}
