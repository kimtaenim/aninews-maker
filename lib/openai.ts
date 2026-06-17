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

// 숏폼 세로 9:16. gpt-image-2 는 임의 해상도를 받지만 가로·세로가 둘 다 16의
// 배수여야 한다(1080 은 16 으로 안 나눠져 400 에러). 1008x1792 는 둘 다 16 배수면서
// 비율이 정확히 9:16 (1008/1792 = 0.5625). generate·edit 둘 다 OK 확인됨.
// (gpt-image-1 로 폴백하면 미지원 → 그땐 1024x1536 으로 내려야 함.)
export const IMAGE_SIZE = "1008x1792" as const;

export type ImageQuality = "low" | "medium" | "high";
