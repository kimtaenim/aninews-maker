// ============================================================================
// 시뮬 표정 얼굴 세트 — 캐릭터당 한 번 생성해 재사용.
// ----------------------------------------------------------------------------
// 중립 1장을 생성한 뒤, 그걸 레퍼런스로 표정만 바꿔 4장을 edit 한다(같은 얼굴 유지).
// 각각 따로 생성하면 얼굴이 달라져서 edit-from-neutral 방식을 쓴다(프로토타입 검증).
// 상태에 따라 플레이·구경 화면에서 이 얼굴들을 바꿔 보여준다.
// 얼굴은 작게 나오고 1회 생성이라 low 화질로 충분(캐릭터당 low 5장 ≈ 77원).
// ============================================================================

import { getOpenAI, IMAGE_MODEL } from "./openai";
import { uploadAsset } from "./blob";
import { getStyleProfile } from "./styleProfiles";
import { openaiImageCostUsd, recordCost } from "./cost";

export const FACE_EXPRESSIONS = [
  { id: "neutral", label: "기본", phrase: "무표정, 담담한 중립 표정" },
  { id: "smile", label: "미소", phrase: "밝게 미소 짓는 표정" },
  { id: "frown", label: "찌푸림", phrase: "미간을 찌푸리고 언짢은 표정" },
  { id: "blush", label: "발그레", phrase: "볼이 발그레하고 수줍은 표정" },
  { id: "sulk", label: "삐짐", phrase: "삐져서 입을 삐죽이고 시선을 옆으로 돌린 표정" },
] as const;

export type FaceId = (typeof FACE_EXPRESSIONS)[number]["id"];

const FACE_SIZE = "1024x1024"; // 얼굴 아바타는 정사각이 낫다
const SHEET =
  "front-facing bust portrait (head and shoulders), single character only, plain neutral background, even soft lighting, no text.";

// 표정 얼굴 5장을 생성해 Blob URL 맵으로 돌려준다.
export async function generateExpressionFaces(args: {
  blobPrefix: string; // 예: "casting/simface-<draftId>"
  projectId?: string; // 비용 기록 연결(선택)
  name?: string;
  archetype?: string;
  description?: string; // 외모 설명(있으면 일관성↑)
}): Promise<{ faces: Record<FaceId, string>; costUsd: number }> {
  const { blobPrefix, projectId, name, archetype, description } = args;
  const client = getOpenAI();
  const bible = getStyleProfile("webtoon-romance").imageBible;
  const who = [name, archetype, description].filter((s) => s?.trim()).join(", ");
  const ts = Date.now();
  let costUsd = 0;

  // 1) 중립 생성.
  const neutralGen = await client.images.generate({
    model: IMAGE_MODEL,
    prompt: `${bible}\n\n${who ? `Character: ${who}. ` : ""}${FACE_EXPRESSIONS[0].phrase}. ${SHEET}`,
    size: FACE_SIZE,
    quality: "low",
    n: 1,
  });
  const neutralB64 = neutralGen.data?.[0]?.b64_json;
  if (!neutralB64) throw new Error("표정 얼굴 생성 실패 — 중립 이미지가 비었어요");
  costUsd += openaiImageCostUsd(IMAGE_MODEL, "low", 1);
  const neutralBytes = Buffer.from(neutralB64, "base64");
  const neutral = await uploadAsset(`${blobPrefix}/face-neutral-${ts}.png`, neutralBytes, "image/png");

  // 얼굴은 '기본 1장'만 만든다. 5장을 한 요청에서 만들면 40~50초 걸려 타임아웃·에러가
  // 났다. 우선 얼굴이 확실히·빠르게(~20초) 뜨는 걸 최우선으로. (표정 변화는 후속 개선.)
  const faces: Record<string, string> = { neutral: neutral.url };

  await recordCost({
    projectId,
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "sim-faces", target: name },
  });

  return { faces: faces as Record<FaceId, string>, costUsd };
}
