// Haiku vision 으로 이미지에서 텍스트 추출(간단 OCR). 첨부 이미지 → 소스 본문.
import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";

const OCR_SYSTEM =
  "You extract text from an image accurately. Return ONLY the text content found in the image as plain text — Korean and English as-is, preserving line breaks. No commentary, no markdown.";
const OCR_USER = "이 이미지에서 글자를 그대로 추출해줘. 추출된 텍스트만 응답.";

type SupportedMime = "image/jpeg" | "image/png" | "image/gif" | "image/webp";
function normalizeMime(mime: string): SupportedMime {
  if (/^image\/(jpeg|png|gif|webp)$/.test(mime)) return mime as SupportedMime;
  return "image/png";
}

export async function ocrImage(
  bytes: Buffer,
  mediaType: string,
  projectId?: string
): Promise<{ text: string; costUsd: number }> {
  const client = getAnthropic();
  const r = await client.messages.create({
    model: MODELS.haiku,
    max_tokens: 4000,
    system: OCR_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: normalizeMime(mediaType),
              data: bytes.toString("base64"),
            },
          },
          { type: "text", text: OCR_USER },
        ],
      },
    ],
  });

  const text = (
    r.content.filter((b) => b.type === "text") as Array<{ type: "text"; text: string }>
  )
    .map((b) => b.text)
    .join("")
    .trim();

  const costUsd = anthropicCostUsd({
    inputTokens: r.usage.input_tokens,
    outputTokens: r.usage.output_tokens,
    cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
    cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
    model: MODELS.haiku,
  });
  try {
    await recordCost({
      projectId,
      vendor: "anthropic",
      model: MODELS.haiku,
      costUsd,
      meta: { kind: "image-ocr" },
    });
  } catch {
    /* best-effort */
  }
  return { text, costUsd };
}
