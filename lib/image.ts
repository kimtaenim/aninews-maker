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

// 3단계 — 키프레임 후보 N장(기본 3장) 생성. 사용자가 그중 하나를 고른다.
// 품질은 빠름·저렴(low) 고정(호출부에서 지정).
export async function generateKeyframes(args: {
  projectId: string;
  styleBible: string;
  scenePrompt: string;
  quality?: ImageQuality;
  count?: number;
}): Promise<{ urls: string[]; costUsd: number }> {
  const { projectId, styleBible, scenePrompt, quality = "low", count = 3 } = args;
  const client = getOpenAI();

  const prompt = `${styleBible}\n\nScene: ${scenePrompt}`;
  const result = await client.images.generate({
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
  sceneIndex: number;
  keyframeUrl: string;
  quality?: ImageQuality;
}): Promise<{ url: string; costUsd: number }> {
  const { projectId, styleBible, scenePrompt, sceneIndex, keyframeUrl, quality = "medium" } =
    args;
  const client = getOpenAI();

  // 키프레임을 레퍼런스로 가져온다 (일관성 유지의 핵심).
  let refRes: Response;
  try {
    refRes = await fetch(keyframeUrl, {
      signal: AbortSignal.timeout(REF_FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new Error("키프레임 이미지를 불러오지 못했어요 (네트워크/타임아웃)");
  }
  if (!refRes.ok) {
    throw new Error(`키프레임 이미지를 불러오지 못했어요 (HTTP ${refRes.status})`);
  }
  const refBytes = Buffer.from(await refRes.arrayBuffer());
  const refFile = await toFile(refBytes, "keyframe.png", { type: "image/png" });

  const prompt =
    `${styleBible}\n\n` +
    "Match the art style, character design, color palette and overall look of the " +
    "reference image exactly. Render a NEW scene described below in that same world.\n\n" +
    `Scene: ${scenePrompt}`;

  const result = await client.images.edit({
    model: IMAGE_MODEL,
    image: refFile,
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
