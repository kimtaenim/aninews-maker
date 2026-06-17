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

// 숏폼 세로 비율. gpt-image-2 지원 사이즈 기준 9:16 근사값.
export const IMAGE_SIZE = "1024x1792" as const;
