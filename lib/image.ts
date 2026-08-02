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
import eyecatchConfig from "../config/eyecatch.json";

const REF_FETCH_TIMEOUT_MS = 30_000;

// 영상용 이미지엔 글자가 많으면 깨지고 지저분하다 — 최소화(금지는 아님).
const NO_TEXT =
  "Keep on-image text minimal: avoid signs, banners, paragraphs, or lots of words. A few short words are okay if natural, but no heavy text overlays.";

// 이미지 모델 전용(Claude 비노출). 자막(subtitlePosition) 자리는 비우고, 인물·주요 물체는
// 자막 반대편에 오도록 능동 배치 지시. (사용자 규칙 — 자막이 화면을 적게 먹을수록 중앙을 더 포함:
//   top·bottom 자막(가장자리 띠) = 중앙 그대로, 그 띠만 비움,
//   ¼·¾ 자막(사분의 일)          = 중앙에서 살짝만 반대편으로,
//   ⅓·⅔ 자막(삼분의 일)          = 중앙과 그 반대편 절반(가운데+반대쪽),
//   중앙 자막                      = 상·하단(가운데 띠 비움).)
// 카메라 앵글·프레이밍은 그 안에서 자연스럽게.
function edgeSafe(position?: string): string {
  const rules: Record<string, { clear: string; place: string }> = {
    top: {
      clear: "top",
      place: "around the center of the frame, simply keeping the top band clear",
    },
    "one-quarter": {
      clear: "upper quarter",
      place: "around the center, nudged slightly downward so the upper quarter stays clear",
    },
    "one-third": {
      clear: "upper third",
      place: "around the center and below it (the middle and lower area of the frame)",
    },
    center: {
      clear: "central/middle",
      place: "in the top and bottom areas, keeping the middle band clear",
    },
    "two-thirds": {
      clear: "lower third",
      place: "around the center and above it (the middle and upper area of the frame)",
    },
    "three-quarters": {
      clear: "lower quarter",
      place: "around the center, nudged slightly upward so the lower quarter stays clear",
    },
    bottom: {
      clear: "bottom",
      place: "around the center of the frame, simply keeping the bottom band clear",
    },
  };
  const r = rules[position ?? ""] ?? rules.bottom;
  return (
    `A subtitle overlay will sit in the ${r.clear} area of the frame — keep that band free of the main subject ` +
    `(no faces, heads, hands, or key objects there). Place the MAIN CONTENT (people and key objects) ${r.place}. ` +
    "Otherwise compose naturally with whatever camera angle, framing, and subject size fit the scene."
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
  imageSize?: string; // 생성 크기(가로x세로). 비면 세로 9:16 기본. 롱폼은 formatDims 로 16:9 전달.
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
    imageSize = IMAGE_SIZE,
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
          size: imageSize,
          quality,
          n,
        })
      : client.images.generate({ model: IMAGE_MODEL, prompt, size: imageSize, quality, n });

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
  imageSize?: string; // 생성 크기(가로x세로). 비면 세로 9:16 기본. 롱폼은 formatDims 로 16:9 전달.
}): Promise<{ url: string; costUsd: number }> {
  const {
    projectId,
    imageUrl,
    narration,
    label,
    quality = "medium",
    subtitlePosition,
    imageSize = IMAGE_SIZE,
  } = args;
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
    size: imageSize,
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
  imageSize?: string; // 생성 크기(가로x세로). 비면 세로 9:16 기본. 롱폼은 formatDims 로 16:9 전달.
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
    imageSize = IMAGE_SIZE,
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
    size: imageSize,
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

// [롱폼 모듈 5] 썸네일 배경 1장 생성 — 글씨는 절대 그리지 않는다(한글 렌더링 신뢰 불가,
// 문구는 후처리로 얹는다). 채널 일관성을 위해 마스코트 정의 + 레퍼런스(있으면 img2img)를 쓴다.
// 크기는 유튜브 썸네일 규격 1280x720(둘 다 16의 배수 — gpt-image-2 요구).
export async function generateThumbnailImage(args: {
  projectId: string;
  prompt: string; // 구도·감정·배경 분리가 담긴 영문 프롬프트
  quality?: ImageQuality;
  styleProfileId?: string; // 숏폼 이미지와 같은 모드 — 화풍을 맞춘다
  // ★ 썸네일 글씨를 그림 안에 직접 그리게 한다(사용자 지정 2026-08-01).
  // 캔버스로 나중에 얹으면 그림과 따로 논다 — 돈 내고 쓰는 모델이 같이 그리는 게 맞다.
  text?: string;
  referenceImageUrl?: string; // 업로드한 참조 — 있으면 기본 마스코트 참조 대신 이걸 쓴다(숏폼과 같게)
}): Promise<{ bytes: Buffer; costUsd: number }> {
  const { projectId, prompt, quality = "medium", styleProfileId, text, referenceImageUrl } = args;
  const styleLine = styleProfileId ? (getStyleProfile(styleProfileId)?.imageBible ?? "") : "";
  const client = getOpenAI();
  const cfg = eyecatchConfig as { description?: string; referenceImageUrl?: string };
  const full =
    `${cfg.description ?? ""}\n\n${prompt}\n\n` +
    (text?.trim()
      ? `Render this exact Korean text INSIDE the image as a bold poster headline: "${text.trim()}". ` +
        "Very large heavy sans-serif, thick dark outline and drop shadow so it stays readable when the " +
        "image is shrunk to 168px wide. Place it on the empty side away from the subject, never covering " +
        "the face. Keep the wording EXACTLY as given — no other text, no logos, no watermarks, " +
        "no extra letters or numbers anywhere."
      : "ABSOLUTELY NO TEXT, letters, numbers, logos, or watermarks anywhere in the image — " +
        "the caption is composited afterwards.") +
    " Leave the bottom-right corner visually quiet " +
    "(YouTube overlays the duration badge there). Avoid pure white and pure black backgrounds.";
  const ref = referenceImageUrl?.trim() || cfg.referenceImageUrl?.trim();
  const result = ref
    ? await client.images.edit({
        model: IMAGE_MODEL,
        image: await fetchRefFile(ref, "썸네일 참조"),
        prompt: full,
        size: "1280x720",
        quality,
        n: 1,
      })
    : await client.images.generate({ model: IMAGE_MODEL, prompt: full, size: "1280x720", quality, n: 1 });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("썸네일 이미지 생성 실패 — 응답에 이미지가 없어요");
  const costUsd = openaiImageCostUsd(IMAGE_MODEL, quality, 1);
  await recordCost({ projectId, vendor: "openai", model: IMAGE_MODEL, costUsd, meta: { kind: "thumbnail", quality } });
  return { bytes: Buffer.from(b64, "base64"), costUsd };
}

// [롱폼] 아이캐치(송곳니 안경 미소녀 마스코트 + 구독 버튼) 1장 생성 — config/eyecatch.json 의
// description(캐릭터 정체성) + eyecatchPrompt(구독 버튼 장면)로 16:9 생성. referenceImageUrl 이
// 등록돼 있으면 img2img 로 더 단단히 고정. 롱폼당 1장 만들어 세그먼트 사이마다 재사용한다.
export async function generateEyecatch(args: {
  projectId: string;
  imageSize?: string; // 기본 16:9 (1792x1008). lib/format.ts 와 동일 값.
  quality?: ImageQuality;
}): Promise<{ url: string; costUsd: number }> {
  const { projectId, imageSize = "1792x1008", quality = "medium" } = args;
  const client = getOpenAI();
  const cfg = eyecatchConfig as {
    description?: string;
    eyecatchPrompt?: string;
    referenceImageUrl?: string;
  };
  // 아이캐치는 구독 버튼(글자 포함)을 '원하는' 화면이라 NO_TEXT 대신 버튼 텍스트를 허용한다.
  const prompt =
    `${cfg.description ?? ""}\n\n${cfg.eyecatchPrompt ?? ""}\n\n` +
    "A bold, clean red SUBSCRIBE button (with a short label) is the focal call-to-action and should be " +
    "crisp and legible. Keep any other on-image text minimal.";
  const ref = cfg.referenceImageUrl?.trim();
  const result = ref
    ? await client.images.edit({
        model: IMAGE_MODEL,
        image: await fetchRefFile(ref, "아이캐치 참조"),
        prompt,
        size: imageSize,
        quality,
        n: 1,
      })
    : await client.images.generate({ model: IMAGE_MODEL, prompt, size: imageSize, quality, n: 1 });
  const b64 = result.data?.[0]?.b64_json;
  if (!b64) throw new Error("아이캐치 생성 실패 — 응답에 이미지가 없어요");
  const { url } = await uploadAsset(
    `project/${projectId}/eyecatch-${Date.now()}.png`,
    Buffer.from(b64, "base64"),
    "image/png"
  );
  const costUsd = openaiImageCostUsd(IMAGE_MODEL, quality, 1);
  await recordCost({
    projectId,
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "eyecatch", quality },
  });
  return { url, costUsd };
}
