// ============================================================================
// xAI(Grok) image-to-video 프로바이더 — fal 대안(잔액·콘텐츠 정책 막힘 시 교차)
// ----------------------------------------------------------------------------
// API: POST https://api.x.ai/v1/videos/generations { model, prompt, image:{url}, duration }
//      → { request_id }. GET https://api.x.ai/v1/videos/{request_id} → status "done" + url.
// submit→poll 패턴이라 fal 과 동일하게 라우트에서 다룬다.
// ============================================================================

import type { VideoPoll } from "./fal";

const API = "https://api.x.ai/v1";
const TIMEOUT_MS = 60_000;
const GROK_VIDEO_MODEL = "grok-imagine-video";

function getKey(): string {
  const k = process.env.XAI_API_KEY;
  if (!k) throw new Error("XAI_API_KEY 가 .env.local 에 없어요");
  return k;
}

function grokError(status: number, bodyText: string): string {
  let detail = bodyText;
  try {
    const j = JSON.parse(bodyText) as { error?: unknown; detail?: unknown; message?: unknown };
    detail = String(j.error ?? j.detail ?? j.message ?? bodyText);
  } catch {
    /* keep raw */
  }
  // 동시 실행 한도/레이트리밋 — 잔액과 다른 문제. 자리가 빌 때까지 기다리면 풀린다.
  if (status === 429 || /rate ?limit|too many|concurren/i.test(detail)) {
    return "Grok 동시 한도/레이트리밋 — 잠시 후 재시도.";
  }
  if (/balance|credit|quota|insufficient/i.test(detail)) {
    return "Grok(xAI) 잔액/크레딧 부족 — console.x.ai 결제 확인.";
  }
  if (/moderation|rejected|content|policy|safety|flag/i.test(detail)) {
    return "콘텐츠 정책에 걸렸어요(영상 거부). 이 씬의 이미지·프롬프트를 더 순화하세요 — 시위·치켜든 주먹·군중·폭력·정치 묘사 등을 빼고 차분한 장면으로 다시 만들어보세요.";
  }
  return `Grok ${status}: ${detail.slice(0, 200)}`;
}

// 제출 → request_id 반환.
// ★ 동시 실행 한도 — Kling·MiniMax(lib/kling.ts·lib/minimax.ts)와 같은 규약으로 자리 대기.
const SLOT_RETRY_MS = 12_000;
const SLOT_WAIT_MS = 100_000;
const SLOT_ERROR = /동시 한도|레이트리밋/;

export async function submitGrokVideo(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
}): Promise<string> {
  const started = Date.now();
  for (;;) {
    try {
      return await submitGrokOnce(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!SLOT_ERROR.test(msg) || Date.now() - started > SLOT_WAIT_MS) throw e;
      await new Promise((res) => setTimeout(res, SLOT_RETRY_MS)); // 자리 빌 때까지 대기 후 재시도
    }
  }
}

async function submitGrokOnce(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model: GROK_VIDEO_MODEL,
    image: { url: opts.imageUrl },
  };
  if (opts.prompt) body.prompt = opts.prompt;
  if (typeof opts.duration === "number") body.duration = opts.duration;

  const r = await fetch(`${API}/videos/generations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${getKey()}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(grokError(r.status, await r.text().catch(() => "")));

  const d = (await r.json()) as { request_id?: string; id?: string };
  const id = d.request_id ?? d.id;
  if (!id) throw new Error("Grok 작업 제출 실패 — request_id 없음");
  return String(id);
}

// 폴링 → 완료면 videoUrl.
export async function pollGrokVideo(requestId: string): Promise<VideoPoll> {
  let r: Response;
  try {
    r = await fetch(`${API}/videos/${requestId}`, {
      headers: { authorization: `Bearer ${getKey()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "Grok 폴링 실패" };
  }
  if (!r.ok) {
    return { status: "failed", error: grokError(r.status, await r.text().catch(() => "")) };
  }

  const d = (await r.json()) as {
    status?: string;
    video?: { url?: string };
    url?: string;
    video_url?: string;
    error?: string;
  };
  const status = (d.status ?? "").toLowerCase();
  if (status === "done" || status === "completed" || status === "succeeded") {
    const url = d.video?.url ?? d.url ?? d.video_url ?? null;
    if (!url) return { status: "failed", error: "Grok 결과에 비디오 URL이 없어요" };
    return { status: "completed", videoUrl: url };
  }
  if (status === "failed" || status === "error") {
    return { status: "failed", error: d.error ?? "Grok 생성 실패" };
  }
  return { status: "running" };
}
