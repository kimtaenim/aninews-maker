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
import { getStyleProfile } from "./styleProfiles";

const REF_FETCH_TIMEOUT_MS = 30_000;

// 영상용 이미지엔 글자가 많으면 깨지고 지저분하다 — 최소화(금지는 아님).
const NO_TEXT =
  "Keep on-image text minimal: avoid signs, banners, paragraphs, or lots of words. A few short words are okay if natural, but no heavy text overlays.";

// 이미지 모델 전용(Claude 비노출). 자막(subtitlePosition) 자리에만 얼굴·머리·손이 오지
// 않게 하는 짧은 안전 지시. 인물 크기·위치·카메라 앵글은 강제하지 않고 자연스럽게 둔다.
function edgeSafe(position?: string): string {
  const area: Record<string, string> = {
    top: "top",
    center: "central",
    "two-thirds": "lower",
    "three-quarters": "lower",
    bottom: "bottom",
  };
  const where = area[position ?? ""] ?? "bottom";
  return (
    `Keep faces, heads, and hands clear of the ${where} area of the frame (an overlay may be placed there). ` +
    "The rest of the composition is unconstrained — compose naturally with whatever camera angle, framing, and " +
    "subject size fits the scene."
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

// [cliche] 캐스팅 포트레이트 참조절 — 키프레임·씬 생성 프롬프트에 공통 주입.
// 포트레이트는 항상 참조 이미지 배열의 "마지막 N장"으로 넣는다(조합 무관하게 지칭 정확).
function castClause(portraitCount: number): string {
  if (portraitCount <= 0) return "";
  return (
    `The LAST ${portraitCount} reference image(s) are character sheet portraits of the CAST — ` +
    "render THESE exact characters (same face, hairstyle, and overall design) wherever people " +
    "appear in the scene. Keep each character's design consistent.\n\n"
  );
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
  portraitUrls?: string[]; // [cliche] 캐스팅 포트레이트들 — 등장인물 외모 고정용 참조
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
    portraitUrls = [],
    subtitlePosition,
  } = args;
  const client = getOpenAI();

  // 참조 이미지가 있으면 그걸 살려서(인물·구도) 스타일 바이블을 입혀 후보 생성.
  // 캐스팅 포트레이트가 있으면 함께 넣어 등장인물 외모를 고정한다(구도 참조 이미지가 첫 장).
  const refClause = referenceImageUrl
    ? "Use the FIRST provided reference image as the basis: preserve its main subject/character and " +
      "composition, but re-render it in the art style and palette described below.\n\n"
    : "";
  const prompt = `${refClause}${castClause(portraitUrls.length)}${styleBible}\n\n${narrationContext(narration)}Scene: ${scenePrompt}\n\n${NO_TEXT}\n\n${edgeSafe(subtitlePosition)}`;

  // 참조/포트레이트가 하나라도 있으면 edit(img2img), 없으면 generate.
  const refUrls = [
    ...(referenceImageUrl ? [referenceImageUrl] : []),
    ...portraitUrls,
  ];

  // gpt-image 는 n=count 한 번 호출해도 모더레이션·부분반환·n 제한으로 요청보다 적게
  // 돌려줄 때가 있다(예: 3장 요청에 2장). 부족하면 단건(n=1)으로 보충해 목표 장수를 맞춘다.
  const genN = async (n: number) =>
    refUrls.length > 0
      ? client.images.edit({
          model: IMAGE_MODEL,
          image: await Promise.all(refUrls.map((u, i) => fetchRefFile(u, `참조${i}`))),
          prompt,
          size: IMAGE_SIZE,
          quality,
          n,
        })
      : client.images.generate({ model: IMAGE_MODEL, prompt, size: IMAGE_SIZE, quality, n });

  const first = await genN(count);
  const b64s: string[] = (first.data ?? [])
    .map((it) => it.b64_json)
    .filter((b): b is string => typeof b === "string" && b.length > 0);
  // 부족분 보충 — 최대 count 번 추가 시도(무한 방지). 추가도 실패하면 있는 것만 쓴다.
  for (let t = 0; b64s.length < count && t < count; t++) {
    try {
      const more = await genN(1);
      const b = more.data?.[0]?.b64_json;
      if (b) b64s.push(b);
    } catch {
      break;
    }
  }
  if (b64s.length === 0) throw new Error("이미지 생성 실패 — 응답에 이미지가 없어요");

  const ts = Date.now();
  const urls: string[] = [];
  for (let i = 0; i < b64s.length; i++) {
    const { url } = await uploadAsset(
      `project/${projectId}/keyframe-${ts}-${i}.png`,
      Buffer.from(b64s[i], "base64"),
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

// 실사 변환 — 이미 만든 그림(일러스트)을 그대로 레퍼런스로 넣어 "구도·인물·배치는 유지,
// 화풍만 실사(사진·영화)로" img2img 재렌더한다. 씬/키프레임 어느 이미지든 이 함수로 변환.
export async function convertToRealistic(args: {
  projectId: string;
  imageUrl: string; // 변환할 원본 이미지(씬 또는 키프레임)
  narration?: string; // 주제 이해용 컨텍스트(글자로 그리지 않음)
  label: string; // Blob 경로용 라벨(예: "keyframe", "scene-3")
  quality?: ImageQuality;
  subtitlePosition?: string; // 비워둘 지점(자막 위치)
}): Promise<{ url: string; costUsd: number }> {
  const { projectId, imageUrl, narration, label, quality = "medium", subtitlePosition } = args;
  const client = getOpenAI();
  const realisticBible = getStyleProfile("realistic").imageBible;
  const refFile = await fetchRefFile(imageUrl, "원본");

  const prompt =
    `${realisticBible}\n\n` +
    "Re-render the SAME scene as the provided reference image in a PHOTOREALISTIC style. Keep the EXACT " +
    "same composition, subject placement, poses, camera framing, and background layout — change ONLY the " +
    "art style to realistic cinematic photography (real human faces and skin, real materials, natural " +
    `lighting). Do not add or remove elements.\n\n${narrationContext(narration)}${NO_TEXT}\n\n${edgeSafe(subtitlePosition)}`;

  const result = await client.images.edit({
    model: IMAGE_MODEL,
    image: refFile,
    prompt,
    size: IMAGE_SIZE,
    quality,
    n: 1,
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("실사 변환 실패 — 응답에 이미지가 없어요");
  const { url } = await uploadAsset(
    `project/${projectId}/${label}-realistic-${Date.now()}.png`,
    Buffer.from(b64, "base64"),
    "image/png"
  );

  const costUsd = openaiImageCostUsd(IMAGE_MODEL, quality, 1);
  await recordCost({
    projectId,
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "realistic-convert", label, quality },
  });
  return { url, costUsd };
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
  portraitUrls?: string[]; // [cliche] 캐스팅 포트레이트들 — 등장인물 외모 고정용 참조
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
    portraitUrls = [],
    paletteHint,
    subtitlePosition,
  } = args;
  const client = getOpenAI();

  // 키프레임은 항상 레퍼런스(일관성 유지의 핵심). reference 모드면 참조본을,
  // 캐스팅 포트레이트가 있으면 그것들도 추가로 함께 넣는다(키프레임이 첫 장).
  const keyframeFile = await fetchRefFile(keyframeUrl, "키프레임");
  const extraFiles = [
    ...(referenceImageUrl ? [referenceImageUrl] : []),
    ...portraitUrls,
  ];
  const refFiles =
    extraFiles.length > 0
      ? [keyframeFile, ...(await Promise.all(extraFiles.map((u, i) => fetchRefFile(u, `참조${i}`))))]
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
  const portraitClause = portraitUrls.length ? ` ${castClause(portraitUrls.length).trim()}` : "";

  const prompt =
    `${styleBible}\n\n` +
    `${styleClause}${refClause}${portraitClause} Render a NEW scene described below in that same world.\n\n` +
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

// [cliche] 캐스팅 포트레이트(캐릭터 시트) 1장 생성 — 새 프로젝트 위저드의 캐스팅 화면용.
//   - faceImageUrl 있음(사진 업로드): 딥페이크 방지 규약 — 그림체와 무관하게 항상
//     "명백한 스타일화 일러스트"로만 변환(실사 유사 복제 금지). 웹툰 바이블 고정.
//   - 없음(설명 생성): 프로젝트 그림체 바이블로 가상 인물 생성(실사 프로필 허용 —
//     실존 인물이 아니므로).
// 프로젝트 생성 전(위저드)에도 쓰도록 projectId 없이 blobPrefix 로 저장 경로를 받는다.
export async function generatePortrait(args: {
  blobPrefix: string; // Blob 경로 prefix (예: "casting/<draftId>" 또는 "project/<id>")
  projectId?: string; // 있으면 비용 기록에 연결
  styleBible: string; // 프로젝트 그림체 바이블(설명 생성 모드에서 사용)
  name?: string;
  archetype?: string; // 클리셰 성격 — 외모 무드에 반영
  description?: string; // 외모 설명(예: "은발 단발, 안경")
  faceImageUrl?: string; // 업로드한 실제 사진(있으면 스타일화 변환 모드)
  quality?: ImageQuality;
}): Promise<{ url: string; costUsd: number }> {
  const {
    blobPrefix,
    projectId,
    styleBible,
    name,
    archetype,
    description,
    faceImageUrl,
    quality = "medium",
  } = args;
  const client = getOpenAI();

  const who = [name, archetype, description].filter((s) => s?.trim()).join(", ");
  const sheet =
    "CHARACTER SHEET PORTRAIT: front-facing bust portrait (head and shoulders), single character " +
    "only, plain neutral background, even soft lighting, no text, no logo. This portrait will be " +
    "used as a reference to keep the character consistent across many scenes.";

  let result;
  if (faceImageUrl) {
    // 업로드 사진 → 항상 웹툰(스타일화) 변환. 실사 유사 복제 금지 규약을 프롬프트에 못박는다.
    const webtoonBible = getStyleProfile("webtoon-romance").imageBible;
    const prompt =
      `${webtoonBible}\n\n` +
      "Using the provided photo ONLY as loose inspiration for vibe (hairstyle, general impression), " +
      "create a CLEARLY STYLIZED webtoon illustration character. This must NOT be a photorealistic " +
      `likeness of the real person in the photo.\n\n${who ? `Character: ${who}.\n\n` : ""}${sheet}`;
    result = await client.images.edit({
      model: IMAGE_MODEL,
      image: await fetchRefFile(faceImageUrl, "얼굴"),
      prompt,
      size: IMAGE_SIZE,
      quality,
      n: 1,
    });
  } else {
    const prompt = `${styleBible}\n\n${who ? `Character: ${who}.\n\n` : ""}${sheet}`;
    result = await client.images.generate({
      model: IMAGE_MODEL,
      prompt,
      size: IMAGE_SIZE,
      quality,
      n: 1,
    });
  }

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("포트레이트 생성 실패 — 응답에 이미지가 없어요");
  const { url } = await uploadAsset(
    `${blobPrefix}/portrait-${Date.now()}.png`,
    Buffer.from(b64, "base64"),
    "image/png"
  );

  const costUsd = openaiImageCostUsd(IMAGE_MODEL, quality, 1);
  await recordCost({
    ...(projectId ? { projectId } : {}),
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "cast-portrait", name: name ?? "", upload: !!faceImageUrl, quality },
  });
  return { url, costUsd };
}
