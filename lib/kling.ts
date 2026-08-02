// ============================================================================
// Kling(직접 API) image-to-video 프로바이더 — fal 경유 Kling 을 대체하는 별도 API.
// ----------------------------------------------------------------------------
// 인증 = 단일 API 키(Bearer). env KLING_API_KEY 하나면 됨(access/secret·JWT 아님).
//   제출: POST {base}/v1/videos/image2video { model_name, image(URL), prompt, duration, mode, aspect_ratio }
//         → { code, data:{ task_id } }
//   폴링: GET  {base}/v1/videos/image2video/{task_id}
//         → { code, data:{ task_status, task_result:{ videos:[{ url }] } } }
// env: KLING_API_KEY(필수). 선택: KLING_API_BASE(기본 https://api.klingai.com),
//      KLING_MODEL(기본 kling-v3), KLING_MODE(기본 std).
// 모델명(model_name)은 config/video-models.json 의 endpoint 로도 넘긴다.
// ============================================================================

import type { VideoPoll } from "./fal";

const TIMEOUT_MS = 60_000;

function base(): string {
  return (process.env.KLING_API_BASE || "https://api.klingai.com").replace(/\/$/, "");
}

function getKey(): string {
  const k = process.env.KLING_API_KEY;
  if (!k) throw new Error("KLING_API_KEY 가 .env 에 없어요");
  return k;
}

function klingError(status: number, bodyText: string): string {
  let detail = bodyText;
  try {
    const j = JSON.parse(bodyText) as { message?: unknown; error?: unknown };
    detail = String(j.message ?? j.error ?? bodyText);
  } catch {
    /* keep raw */
  }
  // 동시 실행 한도(계정 등급별) — 잔액과 다른 문제. 자리가 빌 때까지 기다리면 풀린다.
  if (status === 429 || /parallel task|too many|rate ?limit|1303/i.test(detail)) {
    return "Kling 동시 한도/레이트리밋 — 잠시 후 재시도.";
  }
  if (/balance|credit|quota|insufficient|resource pack/i.test(detail)) {
    return "Kling 잔액/크레딧 부족 — Kling 콘솔 결제 확인.";
  }
  if (/risk|moderation|sensitive|content|policy/i.test(detail)) {
    return "콘텐츠 정책에 걸렸어요(영상 거부). 이 씬의 이미지·프롬프트를 더 순화해 다시 만들어보세요.";
  }
  return `Kling ${status}: ${detail.slice(0, 200)}`;
}

// ★ 동시 실행 한도 — MiniMax(lib/minimax.ts)와 같은 규약으로 자리 대기.
// 씬 일괄 생성에서 한도 에러가 사용자에게 그대로 뜨면 안 된다(2026-08-02).
const SLOT_RETRY_MS = 12_000;
const SLOT_WAIT_MS = 100_000;
const SLOT_ERROR = /동시 한도|레이트리밋/;

// 제출 → task_id 반환.
export async function submitKlingVideo(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  model?: string; // model_name (config endpoint). 없으면 기본(kling-v3).
  aspect?: string; // "16:9" | "9:16" 등
}): Promise<string> {
  const started = Date.now();
  for (;;) {
    try {
      return await submitKlingOnce(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!SLOT_ERROR.test(msg) || Date.now() - started > SLOT_WAIT_MS) throw e;
      await new Promise((res) => setTimeout(res, SLOT_RETRY_MS)); // 자리 빌 때까지 대기 후 재시도
    }
  }
}

async function submitKlingOnce(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  model?: string;
  aspect?: string;
}): Promise<string> {
  const body: Record<string, unknown> = {
    model_name: opts.model || process.env.KLING_MODEL || "kling-v3",
    image: opts.imageUrl,
    mode: process.env.KLING_MODE || "std",
    duration: (opts.duration ?? 5) > 5 ? "10" : "5",
  };
  if (opts.prompt) body.prompt = opts.prompt;
  if (opts.aspect) body.aspect_ratio = opts.aspect;

  const r = await fetch(`${base()}/v1/videos/image2video`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${getKey()}` },
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
      headers: { authorization: `Bearer ${getKey()}` },
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
