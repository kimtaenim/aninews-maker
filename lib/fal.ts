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

// TODO: submitVideoJob(scene, model) → falRequestId  (fal.queue.submit)
// TODO: pollVideoJob(falRequestId) → { status, videoUrl? }  (fal.queue.status/result)
