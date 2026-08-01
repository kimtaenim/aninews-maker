// ============================================================================
// [롱폼 모듈 5] 썸네일 생성 — 이미지 프롬프트 3종(구도 변형) → 이미지 생성 → 글씨 합성.
// ----------------------------------------------------------------------------
// 글씨는 모듈 1의 thumbnail_text 를 그대로 쓴다(썸네일에서 새 문구 창작 금지).
// 이미지엔 텍스트를 넣지 않고(한글 렌더링 신뢰 불가) 후처리로 얹는다 — lib/thumbnailCompose.
// 시안 3종 + 168px 축소 검증본을 만들어 유튜브 "테스트 및 비교"(A/B)에 걸게 한다.
// ============================================================================

import { getAnthropic, MODELS } from "./anthropic";
import { anthropicCostUsd, recordCost } from "./cost";
import { generateThumbnailImage } from "./image";
import { composeThumbnail } from "./thumbnailCompose";
import { uploadAsset } from "./blob";
import principles from "../config/longform-principles.json";
import eyecatchConfig from "../config/eyecatch.json";
import type { LongformThumbnailPackage, LongformThumbnailVariant } from "./types";

export interface ThumbnailPromptVariant {
  composition: string; // 구도 설명(한국어)
  prompt: string; // 영문 이미지 프롬프트
  emotion: string; // 캐릭터가 연기할 감정 1개
  subjectSide: "left" | "right"; // 피사체 위치 — 글씨는 반대편에
}

const SYSTEM = `너는 경제 유튜브 채널 "AI인.경제교양"의 롱폼 썸네일 아트디렉터다.
제목이 약속한 괴리(title_promise)와 첫 세그먼트 소재를 받아, 구도만 다른 이미지 생성 프롬프트 3종을 쓴다.

## 원칙 (단일 원천)

{{PRINCIPLES}}

## 캐릭터(채널 일관성 — 기존 3D 캐릭터 렌더 스타일 유지)

{{MASCOT}}

## 반드시 지킬 것

- 피사체는 하나. 화면의 40% 이상을 차지하게 명시한다.
- 그 피사체는 감정을 연기해야 한다 — title_promise 의 괴리에 맞는 감정 1개(놀람·의심·긴장 등)를
  표정·자세로 프롬프트에 또렷이 적는다. 무표정 금지.
- 배경은 단순하게, 피사체와 명도·색상으로 분리(필요하면 외곽 글로우). 순백·순흑 배경 금지.
- 프롬프트마다 "no text, no letters, no numbers"를 명시한다 — 글씨는 후처리로 얹는다.
- 우하단은 비워둔다(유튜브 재생시간 자리).
- 3종은 구도만 다르게: 예) 클로즈업 / 미디엄 투샷 / 로우앵글 와이드. 스타일·색 톤은 동일하게 유지.
- subject_side 는 피사체가 놓일 쪽이다. 글씨는 그 반대편 위에 얹히므로, 반대편 상단이 비도록 프롬프트에 적는다.

## 출력 형식

아래 JSON만 출력한다. 코드펜스·서문 금지.

{
  "variants": [
    {
      "composition": "구도 한 줄(한국어)",
      "emotion": "감정 1개",
      "subject_side": "left",
      "prompt": "English image generation prompt"
    }
  ]
}`;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export async function generateThumbnailPrompts(args: {
  projectId: string;
  title: string;
  titlePromise: string;
  firstSegmentTopic: string;
  thumbnailText: string;
}): Promise<ThumbnailPromptVariant[]> {
  const client = getAnthropic();
  const mascot = (eyecatchConfig as { description?: string }).description ?? "";
  const system = SYSTEM.replace("{{PRINCIPLES}}", JSON.stringify(principles.thumbnail, null, 2)).replace(
    "{{MASCOT}}",
    mascot
  );
  const user = [
    `[확정 제목] ${args.title}`,
    `[title_promise] ${args.titlePromise}`,
    `[썸네일 문구(이미 확정 — 이걸 후처리로 얹는다)] ${args.thumbnailText}`,
    `[첫 세그먼트 소재] ${args.firstSegmentTopic}`,
  ].join("\n");

  const r = await client.messages.create({
    model: MODELS.sonnet,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: user }],
  });
  const blocks = r.content.filter((b: { type: string }) => b.type === "text") as Array<{ type: "text"; text: string }>;
  const raw = blocks.map((b) => b.text).join("").trim();
  await recordCost({
    projectId: args.projectId,
    vendor: "anthropic",
    model: MODELS.sonnet,
    costUsd: anthropicCostUsd({
      inputTokens: r.usage.input_tokens,
      outputTokens: r.usage.output_tokens,
      cacheReadTokens: r.usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: r.usage.cache_creation_input_tokens ?? undefined,
      model: MODELS.sonnet,
    }),
    meta: { kind: "longform-thumbnail-prompt" },
  });

  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("썸네일 프롬프트 생성 실패 — 응답에서 JSON 을 못 찾았어요");
  let j: { variants?: unknown };
  try {
    j = JSON.parse(m[0]);
  } catch {
    throw new Error("썸네일 프롬프트 JSON 파싱 실패");
  }
  const variants = (Array.isArray(j.variants) ? j.variants : [])
    .map((v) => {
      const o = (v ?? {}) as Record<string, unknown>;
      const side = str(o.subject_side).toLowerCase();
      return {
        composition: str(o.composition),
        prompt: str(o.prompt),
        emotion: str(o.emotion),
        subjectSide: (side === "right" ? "right" : "left") as "left" | "right",
      };
    })
    .filter((v) => v.prompt.length > 0)
    .slice(0, 3);
  if (variants.length === 0) throw new Error("썸네일 프롬프트가 비어 있어요");
  return variants;
}

// 프롬프트 3종 → 이미지 생성 → 글씨 합성 → Blob 업로드까지. 한 시안이 실패해도 나머지는 살린다.
export async function buildThumbnails(args: {
  projectId: string;
  title: string;
  titlePromise: string;
  firstSegmentTopic: string;
  thumbnailText: string;
  // 화면에서 켠 스타일 칩 + 직접 쓴 지시 — 그림에만 붙는다(문구·구도 판정은 그대로).
  styleExtra?: string;
}): Promise<LongformThumbnailPackage> {
  const { projectId, thumbnailText, title, styleExtra } = args;
  const prompts = await generateThumbnailPrompts(args);
  const extra = (styleExtra ?? "").trim();
  const stamp = Date.now();

  const variants: LongformThumbnailVariant[] = [];
  const errors: string[] = [];
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i];
    const base: LongformThumbnailVariant = {
      composition: `${p.composition}${p.emotion ? ` · 감정: ${p.emotion}` : ""}`,
      prompt: p.prompt,
    };
    try {
      const { bytes } = await generateThumbnailImage({
        projectId,
        prompt: extra ? `${p.prompt}. ${extra}` : p.prompt,
      });
      const { jpg, preview, strokePx, readable } = await composeThumbnail({
        background: bytes,
        text: thumbnailText,
        side: p.subjectSide === "left" ? "right" : "left", // 글씨는 피사체 반대편
      });
      const raw = await uploadAsset(`project/${projectId}/thumb-${stamp}-${i}-raw.png`, bytes, "image/png");
      const file = await uploadAsset(`project/${projectId}/thumb-${stamp}-${i}.jpg`, jpg, "image/jpeg");
      const prev = await uploadAsset(`project/${projectId}/thumb-${stamp}-${i}-168.jpg`, preview, "image/jpeg");
      variants.push({
        ...base,
        imageUrl: raw.url,
        fileUrl: file.url,
        previewUrl: prev.url,
        strokePx,
        ...(readable ? {} : { composition: `${base.composition} · ⚠ 문구가 168px에서 안 읽힘` }),
      });
    } catch (e) {
      errors.push(`시안 ${i + 1}: ${e instanceof Error ? e.message : "실패"}`);
      variants.push(base);
    }
  }
  if (variants.every((v) => !v.fileUrl)) {
    throw new Error(`썸네일 시안을 만들지 못했어요 — ${errors.join(" / ")}`);
  }

  const minStroke = Math.min(...variants.map((v) => v.strokePx ?? 0).filter((x) => x > 0), 99);
  const screening: Record<string, string> = {
    "글씨-제목 비중복": title.includes(thumbnailText) ? "탈락 — 제목과 중복" : "통과",
    "초점 1개·감정": "통과 — 프롬프트에 피사체 1개 + 감정 연기 명시",
    "배경 분리": "통과 — 순백·순흑 금지 + 단순 배경 지시",
    "우하단 비움": "통과 — 글씨는 좌상/우상, 우하단 비움 지시",
    "168px 판독": minStroke >= 2 ? `통과 — 획 ${minStroke}px` : `탈락 — 획 ${minStroke}px (2px 미만)`,
    "A/B 안내": "유튜브 스튜디오 '테스트 및 비교'에 시안 3종을 걸 것",
  };
  if (errors.length) screening["생성 오류"] = errors.join(" / ");

  return { textUsed: thumbnailText, variants, screening, generatedAt: Date.now() };
}
