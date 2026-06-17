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
  if (/balance|credit|quota|insufficient/i.test(detail)) {
    return "Grok(xAI) 잔액/크레딧 부족 — console.x.ai 결제 확인.";
  }
  return `Grok ${status}: ${detail.slice(0, 200)}`;
}

// 제출 → request_id 반환.
export async function submitGrokVideo(opts: {
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
