// ============================================================================
// 시뮬 표정 얼굴 세트 — 캐릭터당 한 번 생성해 재사용.
// ----------------------------------------------------------------------------
// 중립 1장을 생성한 뒤, 그걸 레퍼런스로 표정만 바꿔 4장을 edit 한다(같은 얼굴 유지).
// 각각 따로 생성하면 얼굴이 달라져서 edit-from-neutral 방식을 쓴다(프로토타입 검증).
// 상태에 따라 플레이·구경 화면에서 이 얼굴들을 바꿔 보여준다.
//
// ★ 속도(프로덕션 실측): gen ~18s, edit ~32s/장. 5장을 한 요청에 몰면 48~60s → 브라우저
// 먹통·타임아웃. 그래서 호출부(backfill·PlayClient)는 중립을 먼저 빠르게 띄우고 표정 4장은
// 병렬로 쪼개 스트리밍한다. 여기선 그 조각(중립 1장 / 표정 1장)을 각각 노출한다.
// ============================================================================

import { toFile } from "openai";
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

// 표정 id 목록(중립 제외) — 호출부가 병렬로 채운다.
export const EXPRESSION_IDS = FACE_EXPRESSIONS.slice(1).map((e) => e.id) as Exclude<
  FaceId,
  "neutral"
>[];

// 게임 얼굴은 화면에서 max 300px로만 뜨니 모델이 허용하는 최소 정사각으로 뽑는다(더 작고 쌈).
// gpt-image-2 실측(2026-07): 300/304/512/768 → 400 "minimum pixel budget"(÷16 필수 + ~800px 미만 거부),
// 896x896이 통과하는 최소 티어(gen ~18s). ※ edit(표정)은 32s로 사이즈에 거의 무관 — 크기는 60s의 원인 아님.
const FACE_SIZE = "896x896";
const SHEET =
  "front-facing bust portrait (head and shoulders), single character only, plain neutral background, even soft lighting, no text.";

function faceCost(): number {
  return openaiImageCostUsd(IMAGE_MODEL, "low", 1);
}

// ── 조각 1: 중립 얼굴 1장 생성 → 업로드. bytes 도 돌려줘 표정 edit이 재사용하게 한다.
export async function generateNeutralFace(args: {
  blobPrefix: string; // 예: "simgame/<gameId>"
  projectId?: string; // 비용 기록 연결(선택)
  name?: string;
  archetype?: string;
  description?: string;
}): Promise<{ url: string; bytes: Buffer; costUsd: number }> {
  const { blobPrefix, projectId, name, archetype, description } = args;
  const client = getOpenAI();
  const bible = getStyleProfile("webtoon-romance").imageBible;
  const who = [name, archetype, description].filter((s) => s?.trim()).join(", ");

  const gen = await client.images.generate({
    model: IMAGE_MODEL,
    prompt: `${bible}\n\n${who ? `Character: ${who}. ` : ""}${FACE_EXPRESSIONS[0].phrase}. ${SHEET}`,
    size: FACE_SIZE,
    quality: "low",
    n: 1,
  });
  const b64 = gen.data?.[0]?.b64_json;
  if (!b64) throw new Error("표정 얼굴 생성 실패 — 중립 이미지가 비었어요");
  const bytes = Buffer.from(b64, "base64");
  const up = await uploadAsset(`${blobPrefix}/face-neutral-${Date.now()}.png`, bytes, "image/png");
  const costUsd = faceCost();
  await recordCost({
    projectId,
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "sim-faces", target: name, part: "neutral" },
  });
  return { url: up.url, bytes, costUsd };
}

// ── 조각 2: 중립을 레퍼런스로 표정 1장만 edit → 업로드.
// neutralBytes(있으면 바로) 또는 neutralUrl(없으면 로드)로 레퍼런스를 받는다.
export async function generateExpressionFace(args: {
  blobPrefix: string;
  exprId: Exclude<FaceId, "neutral">;
  neutralBytes?: Buffer;
  neutralUrl?: string;
  projectId?: string;
  targetName?: string;
}): Promise<{ url: string; costUsd: number }> {
  const { blobPrefix, exprId, projectId, targetName } = args;
  const expr = FACE_EXPRESSIONS.find((e) => e.id === exprId);
  if (!expr || expr.id === "neutral") throw new Error(`알 수 없는 표정: ${exprId}`);

  let bytes = args.neutralBytes;
  if (!bytes) {
    if (!args.neutralUrl) throw new Error("중립 얼굴이 없어요 — 먼저 중립을 만들어야 합니다");
    const res = await fetch(args.neutralUrl);
    if (!res.ok) throw new Error(`중립 얼굴 로드 실패 (HTTP ${res.status})`);
    bytes = Buffer.from(await res.arrayBuffer());
  }

  const client = getOpenAI();
  const refFile = await toFile(bytes, "neutral.png", { type: "image/png" });
  const edit = await client.images.edit({
    model: IMAGE_MODEL,
    image: refFile,
    prompt:
      `이 웹툰 캐릭터의 얼굴·헤어·의상·화풍을 그대로 유지하고, 표정만 '${expr.phrase}'으로 바꿔라. ` +
      `같은 인물이어야 한다. ${SHEET}`,
    size: FACE_SIZE,
    quality: "low",
    n: 1,
  });
  const b64 = edit.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${exprId}: 응답에 이미지 없음`);
  const up = await uploadAsset(
    `${blobPrefix}/face-${exprId}-${Date.now()}.png`,
    Buffer.from(b64, "base64"),
    "image/png"
  );
  const costUsd = faceCost();
  await recordCost({
    projectId,
    vendor: "openai",
    model: IMAGE_MODEL,
    costUsd,
    meta: { kind: "sim-faces", target: targetName, part: exprId },
  });
  return { url: up.url, costUsd };
}

// ── 통합: 중립 + 표정4장(병렬). 무상태 route(/api/sim/faces)용. 실패는 삼키지 않고 모은다.
export async function generateExpressionFaces(args: {
  blobPrefix: string;
  projectId?: string;
  name?: string;
  archetype?: string;
  description?: string;
}): Promise<{ faces: Record<FaceId, string>; costUsd: number; errors: string[] }> {
  const neutral = await generateNeutralFace(args);
  let costUsd = neutral.costUsd;
  const faces: Record<string, string> = { neutral: neutral.url };
  const errors: string[] = [];

  const results = await Promise.all(
    EXPRESSION_IDS.map(async (exprId) => {
      try {
        const r = await generateExpressionFace({
          blobPrefix: args.blobPrefix,
          exprId,
          neutralBytes: neutral.bytes,
          projectId: args.projectId,
          targetName: args.name,
        });
        return { exprId, url: r.url, costUsd: r.costUsd };
      } catch (e) {
        errors.push(`${exprId}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    })
  );
  for (const r of results) if (r) {
    faces[r.exprId] = r.url;
    costUsd += r.costUsd;
  }

  return { faces: faces as Record<FaceId, string>, costUsd, errors };
}
