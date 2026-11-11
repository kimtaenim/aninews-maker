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

// GPT-Image-2.6 Sunburst 기본(2026-11-11 교체). OpenAI 가 gpt-image-2 지원을
// 2027-02-10 에 종료한다고 통지해 미리 옮긴다. Sunburst 는 품질·편집 일관성 쪽이라
// 참조 이미지로 edit 를 쓰는 키프레임에 맞다(Flare 는 속도 우선).
// ★ 문제가 생기면 OPENAI_IMAGE_MODEL 로 즉시 되돌린다 — 값: gpt-image-2
export const IMAGE_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-image-2.6-sunburst";

// 숏폼 세로 9:16. gpt-image-2 는 임의 해상도를 받지만 가로·세로가 둘 다 16의
// 배수여야 했다(1080 은 16 으로 안 나눠져 400 에러). 1008x1792 는 둘 다 16 배수면서
// 비율이 정확히 9:16 (1008/1792 = 0.5625). gpt-image-2 에서 generate·edit 둘 다 OK.
// ★ 2.6 에서도 같은 규칙인지는 아직 실측 못 했다. 이미지가 400 으로 떨어지면 여기가
//   첫 번째 용의자다 — 에러 메시지를 보고 size 를 새 규칙에 맞춘다.
// (gpt-image-1 로 폴백하면 미지원 → 그땐 1024x1536 으로 내려야 함.)
// [롱폼] 가로 16:9 는 1792x1008(둘 다 16 배수, 1792/1008≈1.778). format 별 크기는
// lib/format.ts 가 단일 원천 — 여기 IMAGE_SIZE 는 기존 호출부 무회귀용 기본(세로).
export const IMAGE_SIZE = "1008x1792" as const;

export type ImageQuality = "low" | "medium" | "high";
