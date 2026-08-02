// ============================================================================
// MiniMax(Hailuo) 직접 API image-to-video — fal 경유를 대체한다.
// ----------------------------------------------------------------------------
// re-animator(worker/minimax.mjs)에서 검증된 연동을 aninews 구조(제출/폴링 분리)로 옮긴 것.
// 공식 API (platform.minimax.io/docs/guides/video-generation):
//   제출: POST {base}/v1/video_generation
//         body { model, prompt, first_frame_image(공개 URL 가능), duration, resolution }
//         → { task_id, base_resp:{ status_code, status_msg } }
//   폴링: GET  {base}/v1/query/video_generation?task_id={id}
//         → { status: Queueing|Preparing|Processing|Success|Fail, file_id }
//   파일: GET  {base}/v1/files/retrieve?file_id={id} → { file:{ download_url } }
//   ★3단계(task → file_id → download_url)라 폴링 완료 시 파일 조회를 한 번 더 한다.
// env: MINIMAX_API_KEY(필수). 선택: MINIMAX_API_BASE, MINIMAX_VIDEO_MODEL,
//      MINIMAX_VIDEO_RESOLUTION(768P|1080P), MINIMAX_VIDEO_COST.
// ============================================================================

import type { VideoPoll } from "./fal";

// ★호스트 failover — MiniMax 는 같은 API 를 여러 도메인으로 서비스한다(전부 동일 응답).
// 한 도메인이 막히면 "fetch failed" 로 씬이 통째로 날아가므로 순서대로 시도하고,
// 성공한 호스트를 기억해 이후 호출은 바로 그걸 쓴다.
const BASES: string[] = [
  process.env.MINIMAX_API_BASE,
  "https://api.minimax.io",
  "https://api.minimaxi.com",
  "https://api.minimaxi.chat",
].filter((b): b is string => !!b);
let goodBase: string | null = null;

const TIMEOUT_MS = 60_000;
const MODEL = process.env.MINIMAX_VIDEO_MODEL || "MiniMax-Hailuo-2.3";
const RESOLUTION = process.env.MINIMAX_VIDEO_RESOLUTION || "1080P"; // 합성에서 프로젝트 비율로 재크롭

// ★env 이름 흔들림 흡수 — 키를 넣었는데도 '없음'으로 잡히는 사고를 막는다.
const KEY_NAMES = [
  "MINIMAX_API_KEY",
  "MINIMAX_KEY",
  "MINIMAX_API_TOKEN",
  "MINIMAX_TOKEN",
  "MINIMAXI_API_KEY",
  "MINI_MAX_API_KEY",
];

function findKey(): string {
  for (const n of KEY_NAMES) {
    const v = (process.env[n] || "").trim();
    if (v) return v;
  }
  return "";
}

export function hasMinimax(): boolean {
  return !!findKey();
}

function apiKey(): string {
  const k = findKey();
  if (!k) throw new Error("MINIMAX_API_KEY 가 .env 에 없어요");
  return k;
}

// ★네트워크 오류 재시도 + 원인 노출.
// Node fetch 는 연결 실패를 전부 "fetch failed" 로 뭉개고 진짜 이유(ENOTFOUND·ECONNRESET 등)를
// err.cause 에 숨긴다 → 로그만 봐선 고칠 수가 없다. cause 코드를 메시지에 담는다.
async function mmFetch(path: string, opts: RequestInit, tries = 2): Promise<Response> {
  const order = goodBase ? [goodBase, ...BASES.filter((b) => b !== goodBase)] : BASES;
  const errs: string[] = [];
  for (const base of order) {
    for (let i = 0; i <= tries; i++) {
      try {
        const r = await fetch(`${base}${path}`, opts);
        if ((r.status === 429 || r.status === 503) && i < tries) {
          await new Promise((res) => setTimeout(res, Math.min(8, 2 ** (i + 1)) * 1000));
          continue;
        }
        if (r.status >= 500 && i >= tries) {
          errs.push(`${new URL(base).host}:HTTP${r.status}`);
          break; // 다음 호스트
        }
        goodBase = base;
        return r;
      } catch (e) {
        const cause = (e as { cause?: { code?: string; errno?: string } }).cause;
        const code = cause?.code || cause?.errno || (e as Error)?.message || "unknown";
        errs.push(`${new URL(base).host}:${code}`);
        // 주소·인증서 오류는 이 호스트에선 재시도 무의미 → 즉시 다음 호스트.
        if (/ENOTFOUND|EAI_AGAIN|CERT|DEPTH_ZERO|ERR_TLS/i.test(String(code))) break;
        if (i >= tries) break;
        await new Promise((res) => setTimeout(res, Math.min(8, 2 ** (i + 1)) * 1000));
      }
    }
  }
  throw new Error(`MiniMax 연결 실패 — ${errs.join(", ")}`);
}

function minimaxError(status: number, bodyText: string): string {
  let detail = bodyText;
  try {
    const j = JSON.parse(bodyText) as {
      base_resp?: { status_msg?: unknown };
      status_msg?: unknown;
      message?: unknown;
    };
    detail = String(j.base_resp?.status_msg ?? j.status_msg ?? j.message ?? bodyText);
  } catch {
    /* keep raw */
  }
  if (status === 401 || status === 403 || /auth|token|unauthor|api key|invalid.*key/i.test(detail))
    return "MiniMax 인증 실패 — MINIMAX_API_KEY 확인.";
  if (/balance|credit|quota|insufficient/i.test(detail))
    return "MiniMax 잔액/크레딧 부족 — MiniMax 콘솔 결제 확인.";
  if (status === 429 || /rate limit|too many|concurren|qps/i.test(detail))
    return "MiniMax 동시 한도/레이트리밋 — 잠시 후 재시도.";
  if (/moderation|risk|sensitive|policy|safety|illegal/i.test(detail))
    return `콘텐츠 정책에 걸렸어요(영상 거부): ${detail.slice(0, 120)}`;
  return `MiniMax ${status}: ${String(detail).slice(0, 160)}`;
}

// MiniMax duration 은 모델별 정수(Hailuo-2.3 = 6 또는 10).
function minimaxDuration(seconds?: number): number {
  const s = Number(seconds) || 6;
  return s <= 8 ? 6 : 10;
}

// ★ 동시 실행 한도(실측 6) — 잔액 문제가 아니라 자리가 빌 때까지 기다리면 풀린다.
// fal 경유 시절엔 fal 큐가 대신 기다려 줬는데, 직접 API 는 우리가 기다려야 한다.
// 씬 6개 넘게 일괄 생성하면 7번째부터 이 에러가 사용자에게 그대로 떴다(2026-08-02).
// 영상 하나가 1~2분이라 몇 초 백오프로는 안 풀린다 — 라우트 상한(120초) 안쪽에서 길게 기다린다.
const SLOT_RETRY_MS = 12_000;
const SLOT_WAIT_MS = 100_000;
const SLOT_ERROR = /동시 한도|레이트리밋/;

// 제출 → task_id. (submitKlingVideo 와 같은 시그니처)
export async function submitMinimaxVideo(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  model?: string; // config endpoint(모델명). 없으면 env/기본.
}): Promise<string> {
  const started = Date.now();
  for (;;) {
    try {
      return await submitMinimaxOnce(opts);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!SLOT_ERROR.test(msg) || Date.now() - started > SLOT_WAIT_MS) throw e;
      await new Promise((res) => setTimeout(res, SLOT_RETRY_MS)); // 자리 빌 때까지 대기 후 재시도
    }
  }
}

async function submitMinimaxOnce(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
  model?: string;
}): Promise<string> {
  const body = {
    model: opts.model || MODEL,
    prompt: String(opts.prompt || "").slice(0, 2000),
    first_frame_image: opts.imageUrl, // 공개 URL 그대로
    duration: minimaxDuration(opts.duration),
    resolution: RESOLUTION,
  };
  const r = await mmFetch("/v1/video_generation", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey()}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(minimaxError(r.status, await r.text().catch(() => "")));
  const d = (await r.json().catch(() => ({}))) as {
    task_id?: unknown;
    base_resp?: { status_code?: number };
  };
  const code = d.base_resp?.status_code;
  if (typeof code === "number" && code !== 0) throw new Error(minimaxError(200, JSON.stringify(d)));
  const id = d.task_id;
  if (!id) throw new Error("MiniMax 제출 실패 — task_id 없음");
  return String(id);
}

// file_id → 다운로드 URL(3단계).
async function retrieveFile(fileId: string): Promise<string> {
  const r = await mmFetch(`/v1/files/retrieve?file_id=${encodeURIComponent(fileId)}`, {
    headers: { authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(minimaxError(r.status, await r.text().catch(() => "")));
  const d = (await r.json().catch(() => ({}))) as { file?: { download_url?: string; url?: string } };
  const url = d.file?.download_url ?? d.file?.url ?? null;
  if (!url) throw new Error("MiniMax 파일 조회 실패 — download_url 없음");
  return String(url);
}

// 폴링 → 완료면 videoUrl. (pollKlingVideo 와 같은 시그니처)
export async function pollMinimaxVideo(taskId: string): Promise<VideoPoll> {
  let r: Response;
  try {
    r = await mmFetch(`/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`, {
      headers: { authorization: `Bearer ${apiKey()}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    return { status: "failed", error: e instanceof Error ? e.message : "MiniMax 폴링 실패" };
  }
  if (!r.ok) {
    return { status: "failed", error: minimaxError(r.status, await r.text().catch(() => "")) };
  }
  const d = (await r.json().catch(() => ({}))) as { status?: unknown; file_id?: unknown };
  const st = String(d.status ?? "").toLowerCase();
  if (st === "success") {
    if (!d.file_id) return { status: "failed", error: "MiniMax 성공했으나 file_id 없음" };
    try {
      return { status: "completed", videoUrl: await retrieveFile(String(d.file_id)) };
    } catch (e) {
      return { status: "failed", error: e instanceof Error ? e.message : "MiniMax 파일 조회 실패" };
    }
  }
  if (st === "fail") return { status: "failed", error: minimaxError(200, JSON.stringify(d)) };
  return { status: "running" }; // Queueing | Preparing | Processing
}
