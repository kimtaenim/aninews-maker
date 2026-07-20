// ============================================================================
// Kling(직접 API) image-to-video 프로바이더 — fal 경유 Kling 을 대체하는 별도 API.
// ----------------------------------------------------------------------------
// 공식 Kling API(Kuaishou). 인증 = JWT(HS256): payload {iss:accessKey, exp, nbf} 를
// secretKey 로 서명해 Authorization: Bearer <jwt>.
//   제출: POST {base}/v1/videos/image2video { model_name, image(URL), prompt, duration, mode, aspect_ratio }
//         → { code, data:{ task_id } }
//   폴링: GET  {base}/v1/videos/image2video/{task_id}
//         → { code, data:{ task_status, task_result:{ videos:[{ url }] } } }
// env: KLING_ACCESS_KEY, KLING_SECRET_KEY (앱). 선택: KLING_API_BASE(기본 https://api.klingai.com).
// 모델명(model_name)은 config/video-models.json 의 endpoint 로 넘긴다(예: kling-v2-master).
// ============================================================================

import crypto from "crypto";
import type { VideoPoll } from "./fal";

const TIMEOUT_MS = 60_000;

function base(): string {
  return (process.env.KLING_API_BASE || "https://api.klingai.com").replace(/\/$/, "");
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Kling 인증 JWT(HS256) — 30분 만료. 매 호출마다 새로 서명.
function signToken(): string {
  const ak = process.env.KLING_ACCESS_KEY;
  const sk = process.env.KLING_SECRET_KEY;
  if (!ak || !sk) throw new Error("KLING_ACCESS_KEY / KLING_SECRET_KEY 가 .env 에 없어요");
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64url(Buffer.from(JSON.stringify({ iss: ak, exp: now + 1800, nbf: now - 5 })));
  const data = `${header}.${payload}`;
  const sig = b64url(crypto.createHmac("sha256", sk).update(data).digest());
  return `${data}.${sig}`;
}

function klingError(status: number, bodyText: string): string {
  let detail = bodyText;
  try {
    const j = JSON.parse(bodyText) as { message?: unknown; error?: unknown };
    detail = String(j.message ?? j.error ?? bodyText);
  } catch {
    /* keep raw */
  }
  if (/balance|credit|quota|insufficient|resource pack/i.test(detail)) {
    return "Kling 잔액/크레딧 부족 — Kling 콘솔 결제 확인.";
  }
  if (/risk|moderation|sensitive|content|policy/i.test(detail)) {
    return "콘텐츠 정책에 걸렸어요(영상 거부). 이 씬의 이미지·프롬프트를 더 순화해 다시 만들어보세요.";
  }
  return `Kling ${status}: ${detail.slice(0, 200)}`;
}

// 제출 → task_id 반환.
export async function submitKlingVideo(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  model?: string; // model_name (config endpoint). 없으면 기본.
  aspect?: string; // "16:9" | "9:16" 등
}): Promise<string> {
  const body: Record<string, unknown> = {
    model_name: opts.model || process.env.KLING_MODEL || "kling-v2-master",
    image: opts.imageUrl,
    mode: process.env.KLING_MODE || "std",
    duration: (opts.duration ?? 5) > 5 ? "10" : "5",
  };
  if (opts.prompt) body.prompt = opts.prompt;
  if (opts.aspect) body.aspect_ratio = opts.aspect;

  const r = await fetch(`${base()}/v1/videos/image2video`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${signToken()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(klingError(r.status, await r.text().catch(() => "")));

  const d = (await r.json()) as { code?: number; message?: string; data?: { task_id?: string } };
  if (typeof d.code === "number" && d.code !== 0) {
    throw new Error(klingError(200, JSON.stringify({ message: d.message })));
  }
  const id = d.data?.task_id;
  if (!id) throw new Error("Kling 작업 제출 실패 — task_id 없음");
  return String(id);
}

// 폴링 → 완료면 videoUrl.
export async function pollKlingVideo(taskId: string): Promise<VideoPoll> {
  let r: Response;
  try {
    r = await fetch(`${base()}/v1/videos/image2video/${taskId}`, {
      headers: { authorization: `Bearer ${signToken()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "Kling 폴링 실패" };
  }
  if (!r.ok) {
    return { status: "failed", error: klingError(r.status, await r.text().catch(() => "")) };
  }

  const d = (await r.json()) as {
    code?: number;
    message?: string;
    data?: {
      task_status?: string;
      task_status_msg?: string;
      task_result?: { videos?: Array<{ url?: string }> };
    };
  };
  const status = (d.data?.task_status ?? "").toLowerCase();
  if (status === "succeed") {
    const url = d.data?.task_result?.videos?.[0]?.url ?? null;
    if (!url) return { status: "failed", error: "Kling 결과에 비디오 URL이 없어요" };
    return { status: "completed", videoUrl: url };
  }
  if (status === "failed") {
    return { status: "failed", error: d.data?.task_status_msg || d.message || "Kling 생성 실패" };
  }
  return { status: "running" }; // submitted | processing
}
