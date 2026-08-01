// ============================================================================
// [확장판 ⑥] 챕터 본문 → 씬 배열. 렌더 경로를 새로 만들지 않기 위한 어댑터.
// ----------------------------------------------------------------------------
// 확장판은 별도 렌더 경로가 없다 — 챕터 본문을 씬으로 펼치면 그 뒤는 기존 파이프라인
// (키프레임 → 씬 이미지 → 영상 → 보이스오버 → 합성)이 그대로 처리한다.
//   · 씬 하나는 쇼츠와 같은 4~7초(lib/scenes.ts DURATION_MIN/MAX 가 원천)
//   · 근거 표시 [F-001] 은 여기서 지운다(낭독·자막에 들어가면 안 된다)
//   · 강조 마크업 [[ ]] 은 그대로 둔다(자막 엔진이 읽는다)
// ============================================================================

import { CHARS_PER_SEC } from "./longformScreening";
import { DURATION_MAX, DURATION_MIN } from "./scenes";
import { stripCardRefs } from "./elongatedFormat";
import shortsPrinciples from "../config/script-principles.json";
import type { ElongatedPlan, Scene } from "./types";

// ★ 구독 마무리 문구는 채널 표준이 하나뿐이다 — 쇼츠 ⑧씬 문구를 글자 그대로 쓴다.
// 롱폼용으로 새로 지어내지 마라(2026-07-25 사고: 임의로 만든 문구가 채널 표준을 틀리게 했다).
export const OUTRO_TEXT: string = shortsPrinciples.structure.scene_8.text;

// 씬 하나에 담을 글자 수 — 초 × 낭독 속도. 상한·하한의 원천은 lib/scenes.ts 다.
export const SCENE_CHARS_MAX = Math.floor(DURATION_MAX * CHARS_PER_SEC); // 7초 ≈ 37자
export const SCENE_CHARS_MIN = Math.floor(DURATION_MIN * CHARS_PER_SEC); // 4초 ≈ 21자

/** 낭독 글자 수 → 씬 길이(초). 4~7 로 자른다. */
export function durationFor(chars: number): number {
  const sec = Math.round(chars / CHARS_PER_SEC);
  return Math.max(DURATION_MIN, Math.min(DURATION_MAX, sec || DURATION_MIN));
}

// 문장 단위로 끊는다(한국어 종결어미 + 마침표류). 강조 마크업은 건드리지 않는다.
function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// 상한을 넘는 한 문장은 쉼표·조사 뒤에서, 그래도 길면 공백에서 나눈다(글자 중간에서 안 끊는다).
function splitLong(sentence: string, max: number): string[] {
  if (sentence.length <= max) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > max) {
    const window = rest.slice(0, max + 1);
    let cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("，"));
    if (cut < SCENE_CHARS_MIN) cut = window.lastIndexOf(" ");
    if (cut < SCENE_CHARS_MIN) cut = max; // 끊을 자리가 없으면 상한에서
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/**
 * 본문 한 덩어리 → 씬 나레이션들.
 * 문장을 상한까지 그리디로 묶는다. 마지막 조각이 너무 짧으면 앞 조각에 붙인다(토막 방지).
 */
export function splitIntoScenes(body: string, max = SCENE_CHARS_MAX): string[] {
  const clean = stripCardRefs(body ?? "");
  if (!clean) return [];
  const out: string[] = [];
  let cur = "";
  for (const s of sentences(clean)) {
    for (const piece of splitLong(s, max)) {
      if (!cur) {
        cur = piece;
      } else if (cur.length + 1 + piece.length <= max) {
        cur = `${cur} ${piece}`;
      } else {
        out.push(cur);
        cur = piece;
      }
    }
  }
  if (cur) out.push(cur);
  // 마지막이 4초도 안 되면 앞 씬에 붙인다 — 다만 붙여서 상한을 크게 넘기면 그냥 둔다.
  if (out.length >= 2) {
    const last = out[out.length - 1];
    const prev = out[out.length - 2];
    if (last.length < SCENE_CHARS_MIN && prev.length + 1 + last.length <= max + SCENE_CHARS_MIN) {
      out.splice(out.length - 2, 2, `${prev} ${last}`);
    }
  }
  return out;
}

function sceneOf(narration: string, index: number): Scene {
  return {
    index,
    narration,
    imagePrompt: "",
    motion: "",
    durationSec: durationFor(narration.replace(/\[\[|\]\]/g, "").length),
    status: "generated",
  };
}

/**
 * 설계 + 본문 → 씬 배열. 이미지·모션 프롬프트는 비워 둔다 — 기존 3·4·5단계가 채운다.
 * 챕터 순서 그대로 이어 붙이므로 재생 순서가 곧 챕터 순서다.
 * 마지막에 채널 표준 구독 문구 씬을 붙인다(설계는 이 씬을 챕터로 만들지 않는다).
 */
export function buildScenesFromPlan(plan: ElongatedPlan, withOutro = true): Scene[] {
  const scenes: Scene[] = [];
  for (const c of plan.chapters) {
    for (const narration of splitIntoScenes(c.body ?? "")) {
      scenes.push(sceneOf(narration, scenes.length));
    }
  }
  if (withOutro && scenes.length > 0 && OUTRO_TEXT.trim()) {
    scenes.push(sceneOf(OUTRO_TEXT.trim(), scenes.length));
  }
  return scenes;
}
