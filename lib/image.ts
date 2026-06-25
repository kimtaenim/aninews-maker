// ============================================================================
// 이미지 생성 (3·4단계) — gpt-image-2
// ----------------------------------------------------------------------------
// 3단계 keyframe: 씬0 한 장으로 스타일·인물·팔레트 확정 (style_bible + 씬0 프롬프트).
// 4단계 scene: 키프레임을 레퍼런스(edits)로 넣어 일관성 유지.
// 결과 bytes 는 Blob 에 올리고 공개 URL 을 반환한다.
// ============================================================================

import { toFile } from "openai";
import { getOpenAI, IMAGE_MODEL, IMAGE_SIZE, type ImageQuality } from "./openai";
import { uploadAsset } from "./blob";
import { openaiImageCostUsd, recordCost } from "./cost";

const REF_FETCH_TIMEOUT_MS = 30_000;

// 영상용 이미지엔 글자가 많으면 깨지고 지저분하다 — 최소화(금지는 아님).
const NO_TEXT =
  "Keep on-image text minimal: avoid signs, banners, paragraphs, or lots of words. A few short words are okay if natural, but no heavy text overlays.";

// 사용자가 지정한 한 영역(position)과 그 주변에는 인물의 얼굴·머리·손이 오지 않게 배치한다
// (그 위에 텍스트 등 오버레이가 올라갈 수 있음). 지정 영역은 비우지 말고 배경·하늘·소품으로
// 차분히 채우고, 나머지 화면은 인물·배경을 자유롭게 그린다.
function edgeSafe(position?: string): string {
  const band: Record<string, string> = {
    top: "the top area",
    center: "the vertical middle",
    "two-thirds": "the lower-middle area (around two-thirds height)",
    "three-quarters": "the lower area (around three-quarters height)",
    bottom: "the bottom area",
  };
  const zone = band[position ?? ""] ?? band["three-quarters"];
  return (
    `The ${zone} of the vertical frame is a designated area reserved by the user (text or other overlay may ` +
    `be placed there). Keep people's faces, heads, and hands clear of that designated area and the band right ` +
    `around it. The ${zone} area should be visually calm with background, sky, or simple props — no heads or ` +
    "hands there. The rest of the frame can include people, body, props, and environment naturally; do not " +
    "leave the scene blank."
  );
}

// 씬 나레이션을 이미지 프롬프트에 "주제 이해용 컨텍스트"로 끼운다. 비주얼 권한은
// 여전히 scenePrompt(image_prompt) 에 있고, 나레이션은 글자로 그리지 말라고 못박는다.
function narrationContext(narration?: string): string {
  const n = narration?.trim();
  if (!n) return "";
  return (
    "Context — what this scene narrates (Korean, for understanding the topic only; " +
    "do NOT render this text in the image, and keep the visual calm and metaphorical): " +
    `${n}\n\n`
  );
}

// 레퍼런스 URL → OpenAI 업로드용 파일. 실패 시 사용자 친화 메시지.
async function fetchRefFile(url: string, label: string) {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(REF_FETCH_TIMEOUT_MS) });
  } catch {
    throw new Error(`${label} 이미지를 불러오지 못했어요 (네트워크/타임아웃)`);
  }
  if (!res.ok) throw new Error(`${label} 이미지를 불러오지 못했어요 (HTTP ${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  return toFile(bytes, `${label}.png`, { type: "image/png" });
}

// 3단계 — 키프레임 후보 N장(기본 3장) 생성. 사용자가 그중 하나를 고른다.
// 품질은 빠름·저렴(low) 고정(호출부에서 지정).
export async function generateKeyframes(args: {
  projectId: string;
  styleBible: string;
  scenePrompt: string;
  narration?: string; // 해당 씬 나레이션 — 주제 이해용 컨텍스트(비주얼은 scenePrompt 가 주도)
  quality?: ImageQuality;
  count?: number;
  referenceImageUrl?: string; // 있으면 이 이미지를 레퍼런스로 img2img(인물/구도 살림)
  subtitlePosition?: string; // 비워둘 지점(자막 위치) — 그 띠만 배경/소품만 두게 한다
}): Promise<{ urls: string[]; costUsd: number }> {
  const {
    projectId,
    styleBible,
    scenePrompt,
    narration,
    quality = "low",
    count = 3,
    referenceImageUrl,
    subtitlePosition,
  } = args;
  const client = getOpenAI();

  // 참조 이미지가 있으면 그걸 살려서(인물·구도) 스타일 바이블을 입혀 후보 생성.
  const refClause = referenceImageUrl
    ? "Use the provided reference image as the basis: preserve its main subject/character and " +
      "composition, but re-render it in the art style and palette described below.\n\n"
    : "";
  const prompt = `${refClause}${styleBible}\n\n${narrationContext(narration)}Scene: ${scenePrompt}\n\n${NO_TEXT}\n\n${edgeSafe(subtitlePosition)}`;

  const result = referenceImageUrl
    ? await client.images.edit({
        model: IMAGE_MODEL,
        image: await fetchRefFile(referenceImageUrl, "참조"),
        prompt,
        size: IMAGE_SIZE,
        quality,
        n: count,
      })
    : await client.images.generate({
        model: IMAGE_MODEL,
        prompt,
        size: IMAGE_SIZE,
        quality,
        n: count,
      });

  const items = result.data ?? [];
  if (items.length === 0) throw new Error("이미지 생성 실패 — 응답에 이미지가 없어요");

  const ts = Date.now();
  const urls: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const b64 = items[i].b64_json;
    if (!b64) continue;
    const { url } = await uploadAsset(
      `project/${projectId}/keyframe-${ts}-${i}.png`,
      Buffer.from(b64, "base64"),
      "image/png"
    );
    urls.push(url);
  }
  if (urls.length === 0) throw new Error("이미지 업로드 실패");

  const costUsd = openaiImageCostUsd(IMAGE_MODEL, quality, urls.length);
  await recordCost({
    projectId,
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "keyframe", quality, count: urls.length },
  });

  return { urls, costUsd };
}

// 4단계 — 씬별 이미지. 키프레임을 레퍼런스(images.edit)로 넣어 스타일·인물·
// 팔레트를 씬0과 일치시킨다. 씬 단위 호출(리롤 1장)이라 keyframe 와 같은 모델.
export async function generateScene(args: {
  projectId: string;
  styleBible: string;
  scenePrompt: string;
  narration?: string; // 해당 씬 나레이션 — 주제 이해용 컨텍스트(비주얼은 scenePrompt 가 주도)
  sceneIndex: number;
  keyframeUrl: string;
  quality?: ImageQuality;
  referenceImageUrl?: string; // reference 모드: 키프레임과 함께 넣는 추가 참조(인물 보존)
  paletteHint?: string; // 비면 키프레임 팔레트 그대로, 있으면 색감/조명만 그쪽으로 변주
  subtitlePosition?: string; // 비워둘 지점(자막 위치) — 그 띠만 배경/소품만 두게 한다
}): Promise<{ url: string; costUsd: number }> {
  const {
    projectId,
    styleBible,
    scenePrompt,
    narration,
    sceneIndex,
    keyframeUrl,
    quality = "medium",
    referenceImageUrl,
    paletteHint,
    subtitlePosition,
  } = args;
  const client = getOpenAI();

  // 키프레임은 항상 레퍼런스(일관성 유지의 핵심). reference 모드면 참조본을 추가로 함께 넣는다.
  const keyframeFile = await fetchRefFile(keyframeUrl, "키프레임");
  const refFiles = referenceImageUrl
    ? [keyframeFile, await fetchRefFile(referenceImageUrl, "참조")]
    : keyframeFile;

  // 팔레트 변주: 있으면 "색감만 시프트, 인물·화풍은 유지"로 약화. 없으면 팔레트까지 일치.
  const styleClause = paletteHint?.trim()
    ? "Keep the art style, character design and overall look consistent with the first reference " +
      `image, but shift the COLOR PALETTE, lighting and mood toward: ${paletteHint.trim()}.`
    : "Match the art style, character design, color palette and overall look of the " +
      "reference image exactly.";
  const refClause = referenceImageUrl
    ? " A second reference image is also provided — preserve the specific character(s)/subject " +
      "from it (their design and identity) while keeping the first image's art style."
    : "";

  const prompt =
    `${styleBible}\n\n` +
    `${styleClause}${refClause} Render a NEW scene described below in that same world.\n\n` +
    `${narrationContext(narration)}Scene: ${scenePrompt}\n\n${NO_TEXT}\n\n${edgeSafe(subtitlePosition)}`;

  const result = await client.images.edit({
    model: IMAGE_MODEL,
    image: refFiles,
    prompt,
    size: IMAGE_SIZE,
    quality,
    n: 1,
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("이미지 생성 실패 — 응답에 이미지가 없어요");
  const bytes = Buffer.from(b64, "base64");

  // 유니크 경로 → 리롤 시 새 URL(캐시 버스팅), 덮어쓰기 충돌 없음.
  const { url } = await uploadAsset(
    `project/${projectId}/scene-${sceneIndex}-${Date.now()}.png`,
    bytes,
    "image/png"
  );

  const costUsd = openaiImageCostUsd(IMAGE_MODEL, quality, 1);
  await recordCost({
    projectId,
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "scene", sceneIndex, quality },
  });

  return { url, costUsd };
}
