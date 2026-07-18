// ============================================================================
// 뉴스 고정 마무리 씬(구독·좋아요 유도) — 스크립트 생성 원칙.
// ----------------------------------------------------------------------------
// 뉴스 스크립트 생성 때마다 마지막에 붙는다. 등장인물이 손 흔들며 인사하는 컷 + 이 자막.
// 목소리·속도는 다른 씬과 동일(프로젝트 기본). 단, 이미 비슷한 구독/좋아요 유도 문구가
// 마지막 씬에 있으면 중복으로 넣지 않는다.
// ============================================================================

import { estimateDuration } from "./scenes";
import type { Scene } from "./types";

export const OUTRO_NARRATION = "아침저녁으로 올리는 경제교양!! 구독하고 좋아요 눌러주세요.";

// 마지막 씬이 이미 구독/좋아요 유도(CTA)면 true — 중복 방지용. 마지막 씬만 본다
// (본문 중간에 '구독'이 나오는 뉴스 내용과 헷갈리지 않게).
export function hasSubscribeOutro(scenes: { narration?: string }[]): boolean {
  const last = scenes[scenes.length - 1];
  return !!last && /구독|좋아요/.test(last.narration ?? "");
}

export function newsOutroScene(index: number): Scene {
  return {
    index,
    narration: OUTRO_NARRATION,
    imagePrompt:
      "영상 속 등장인물들이 함께 카메라를 향해 환하게 웃으며 손을 흔들어 인사하는 밝은 마무리 장면",
    motion:
      "Characters smile warmly and wave goodbye at the camera, gentle push-in, soft bright lighting",
    durationSec: estimateDuration(OUTRO_NARRATION),
    status: "generated",
  };
}

// 뉴스 마무리 씬을 붙인다 — 이미 마지막 씬이 구독/좋아요 유도면 안 붙임(중복 방지).
export function appendNewsOutro(scenes: Scene[]): Scene[] {
  if (hasSubscribeOutro(scenes)) return scenes;
  return [...scenes, newsOutroScene(scenes.length)];
}
