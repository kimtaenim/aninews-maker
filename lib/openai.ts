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

// 숏폼 세로 9:16. gpt-image-2 는 임의 해상도(WIDTHxHEIGHT)를 지원하므로
// generate(키프레임)·edit(씬 레퍼런스) 둘 다 1080x1920 을 받는다.
// (gpt-image-1 로 폴백하면 1080x1920 미지원 → 그땐 1024x1536 으로 내려야 함.)
export const IMAGE_SIZE = "1080x1920" as const;

export type ImageQuality = "low" | "medium" | "high";
