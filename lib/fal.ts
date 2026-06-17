// ============================================================================
// fal image-to-video 프로바이더 (골격)
// ----------------------------------------------------------------------------
// 영상 생성은 분 단위 비동기 작업이라 "제출(submit) → 폴링(poll)" 구조.
// 기본 모델은 Seedance이며 config/video-models.json 으로 교체 가능.
// 실제 제출/폴링/결과 다운로드는 jobQueue + worker 와 함께 채운다.
// ============================================================================

import { fal } from "@fal-ai/client";
import videoModels from "../config/video-models.json";

let _configured = false;

export function configureFal(): typeof fal {
  if (_configured) return fal;
  const key = process.env.FAL_KEY;
  if (!key) throw new Error("FAL_KEY missing in .env.local");
  fal.config({ credentials: key });
  _configured = true;
  return fal;
}

export interface VideoModel {
  id: string;
  endpoint: string; // fal 모델 endpoint (예: "fal-ai/bytedance/seedance/...")
  label: string;
  defaultParams: Record<string, unknown>;
}

export function getVideoModel(id?: string): VideoModel {
  const models = videoModels.models as VideoModel[];
  const chosen = id
    ? models.find((m) => m.id === id)
    : models.find((m) => m.id === videoModels.default);
  if (!chosen) throw new Error(`video model not found: ${id ?? videoModels.default}`);
  return chosen;
}

// 실제 fal endpoint. FAL_VIDEO_MODEL 로 override, 기본 minimax-video image-to-video.
export const FAL_DEFAULT_VIDEO_MODEL = "fal-ai/minimax-video/image-to-video";

export function videoEndpoint(): string {
  return process.env.FAL_VIDEO_MODEL || FAL_DEFAULT_VIDEO_MODEL;
}

// jobId = "endpoint::requestId" — poll 이 endpoint 없이 자족하도록 인코딩.
const JOB_SEP = "::";

// fal 에러를 사람이 읽을 메시지로. 가장 흔한 건 잔액 부족(403 Forbidden).
function falErrorMessage(e: unknown): string {
  const err = e as { status?: number; message?: string; body?: { detail?: string } };
  const detail = err?.body?.detail;
  if (detail && /exhausted|locked|balance/i.test(detail)) {
    return "fal 잔액이 부족해요. fal.ai/dashboard/billing 에서 충전(결제수단 등록)하면 비디오가 생성됩니다.";
  }
  if (detail) return `fal: ${detail}`;
  if (err?.status === 403) {
    return "fal 접근 거부(403) — 대개 잔액 부족입니다. fal.ai/dashboard/billing 확인.";
  }
  return err?.message || "fal 요청 실패";
}

export type VideoPoll =
  | { status: "pending" | "running" }
  | { status: "completed"; videoUrl: string }
  | { status: "failed"; error: string };

// 5단계 — 씬 이미지 → image-to-video 작업 제출. 즉시 jobId 반환(분 단위 비동기).
export async function generateVideo(opts: {
  imageUrl: string;
  prompt?: string;
  duration?: number;
}): Promise<{ jobId: string }> {
  const client = configureFal();
  const endpoint = videoEndpoint();

  const input: Record<string, unknown> = { image_url: opts.imageUrl };
  if (opts.prompt) input.prompt = opts.prompt;
  if (typeof opts.duration === "number") input.duration = opts.duration;

  let request_id: string | undefined;
  try {
    const r = await client.queue.submit(endpoint, { input });
    request_id = r.request_id;
  } catch (e) {
    throw new Error(falErrorMessage(e));
  }
  if (!request_id) throw new Error("fal 작업 제출 실패 — request_id 없음");
  return { jobId: `${endpoint}${JOB_SEP}${request_id}` };
}

// fal 결과 payload 에서 비디오 URL 추출 (모델별 스키마 차이 흡수).
function extractVideoUrl(data: unknown): string | null {
  const d = data as { video?: { url?: string }; video_url?: string; url?: string } | null;
  return d?.video?.url ?? d?.video_url ?? d?.url ?? null;
}

// jobId 로 상태 확인. 완료면 videoUrl(임시 fal URL)까지. 라우트가 Blob 로 옮긴다.
export async function pollVideo(jobId: string): Promise<VideoPoll> {
  const sep = jobId.indexOf(JOB_SEP);
  if (sep === -1) return { status: "failed", error: "잘못된 jobId" };
  const endpoint = jobId.slice(0, sep);
  const requestId = jobId.slice(sep + JOB_SEP.length);

  const client = configureFal();
  try {
    const st = await client.queue.status(endpoint, { requestId });
    if (st.status === "COMPLETED") {
      const res = await client.queue.result(endpoint, { requestId });
      const videoUrl = extractVideoUrl(res.data);
      if (!videoUrl) return { status: "failed", error: "결과에 비디오 URL이 없어요" };
      return { status: "completed", videoUrl };
    }
    if (st.status === "IN_QUEUE") return { status: "pending" };
    return { status: "running" }; // IN_PROGRESS 등
  } catch (e) {
    return { status: "failed", error: falErrorMessage(e) };
  }
}
