import OpenAI from "openai";

let _client: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing in .env.local");
  _client = new OpenAI({
    apiKey,
    maxRetries: 3,
    timeout: 120_000,
  });
  return _client;
}

// gpt-image-2 기본. 계정에 아직 없으면 OPENAI_IMAGE_MODEL=gpt-image-1 로 override.
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2";

// gpt-image 는 정확한 9:16 을 지원하지 않음. 세로 비율 중 가장 가까운 2:3
// (1024x1536). 정확한 9:16 프레이밍은 이후 영상/합성 단계에서 크롭·레터박스.
export const IMAGE_SIZE = "1024x1536" as const;

export type ImageQuality = "low" | "medium" | "high";
