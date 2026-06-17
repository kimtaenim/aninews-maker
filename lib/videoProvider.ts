// ============================================================================
// 비디오 프로바이더 디스패처 — fal / grok 교차 사용
// ----------------------------------------------------------------------------
// video-models.json 의 provider 로 라우팅. jobId 는 "provider::..." 로 인코딩해
// 폴링이 어느 프로바이더인지 알 수 있게 한다.
//   - fal  jobId: "fal::<endpoint>::<requestId>"
//   - grok jobId: "grok::<requestId>"
// ============================================================================

import videoModels from "../config/video-models.json";
import { generateVideo as falGenerate, pollVideo as falPoll, type VideoPoll } from "./fal";
import { submitGrokVideo, pollGrokVideo } from "./grok";
import { falVideoCostUsd, grokVideoCostUsd } from "./cost";

export type VideoProvider = "fal" | "grok";

export interface VideoModel {
  id: string;
  provider: VideoProvider;
  label: string;
  endpoint: string;
  defaultParams: Record<string, unknown>;
}

export const DEFAULT_VIDEO_MODEL_ID: string = videoModels.default;

export function listVideoModels(): VideoModel[] {
  return videoModels.models as VideoModel[];
}

export function getVideoModel(id?: string): VideoModel {
  const models = listVideoModels();
  const chosen =
    (id && models.find((m) => m.id === id)) ||
    models.find((m) => m.id === DEFAULT_VIDEO_MODEL_ID) ||
    models[0];
  if (!chosen) throw new Error(`video model not found: ${id ?? DEFAULT_VIDEO_MODEL_ID}`);
  return chosen;
}

const SEP = "::";

export async function submitVideo(
  modelId: string,
  opts: { imageUrl: string; prompt?: string; duration?: number }
): Promise<{ jobId: string }> {
  const model = getVideoModel(modelId);
  if (model.provider === "grok") {
    const requestId = await submitGrokVideo(opts);
    return { jobId: `grok${SEP}${requestId}` };
  }
  // fal — falGenerate 가 "<endpoint>::<requestId>" 를 돌려줌. 모델 필수 파라미터 전달.
  const { jobId } = await falGenerate({
    ...opts,
    endpoint: model.endpoint,
    params: model.defaultParams,
  });
  return { jobId: `fal${SEP}${jobId}` };
}

export async function pollVideoJob(jobId: string): Promise<VideoPoll> {
  if (jobId.startsWith(`grok${SEP}`)) {
    return pollGrokVideo(jobId.slice(`grok${SEP}`.length));
  }
  if (jobId.startsWith(`fal${SEP}`)) {
    return falPoll(jobId.slice(`fal${SEP}`.length)); // "<endpoint>::<requestId>"
  }
  // 프로바이더 프리픽스가 없으면 옛 형식(fal "<endpoint>::<requestId>") — 그대로 fal 폴링.
  return falPoll(jobId);
}

export function videoCostUsd(modelId: string): number {
  const model = getVideoModel(modelId);
  if (model.provider === "grok") return grokVideoCostUsd();
  return falVideoCostUsd(model.endpoint);
}

export function videoVendor(modelId: string): "fal" | "grok" {
  return getVideoModel(modelId).provider;
}
