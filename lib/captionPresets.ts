// ============================================================================
// 자막 스타일 프리셋 — 씬별로 자막 "룩"을 바꾼다(예능식 다양한 자막).
// ----------------------------------------------------------------------------
// 프로젝트 자막 설정(SubtitleSettings)의 위치·크기·정렬은 그대로 두고, 프리셋이
// 폰트·박스·색·모서리·외곽선만 덮어쓴다. 미리보기(lib)와 최종 합성(worker)이 같은
// 레시피를 쓰도록 worker/caption-presets.mjs 에 동일 로직을 복제한다 — 같이 수정할 것.
// 폰트는 sans/serif 만 사용(워커에 있는 것). 손글씨는 폰트 번들 후 추가.
// ============================================================================

import type { SubtitleSettings } from "./types";

export interface CaptionRecipe {
  font: "sans" | "serif" | "hand" | "impact" | "romance" | "brush" | "jua" | "retro";
  weight: 500 | 700;
  box: "solid" | "none";
  boxFill: string; // 박스 배경 (canvas fillStyle · CSS background 공용 색 문자열)
  textColor: string;
  emColor: string; // 강조([[..]]) 색
  radiusRel: number; // 모서리 반경 = radiusRel × 글자크기 (0=각짐, ≥1=알약/pill)
  outline: boolean; // 박스 없을 때 글자 외곽선(어떤 배경에서도 읽히게)
}

// UI 칩 목록 — [id, 라벨]. ""(빈 id) = 기본.
export const CAPTION_STYLES = [
  ["", "기본"],
  ["accent", "강조박스"],
  ["serif", "감성명조"],
  ["bubble", "말풍선"],
  ["hand", "손글씨"],
  ["impact", "임팩트"],
  ["romance", "감성세리프"],
  ["brush", "붓글씨"],
  ["jua", "발랄"],
  ["retro", "복고"],
] as const;

// 기본(프리셋 없음): 프로젝트 자막 설정 그대로 — 기존 렌더와 픽셀 동일.
function defaultRecipe(sub: SubtitleSettings): CaptionRecipe {
  const light = sub.box === "light";
  return {
    font: sub.font,
    weight: sub.weight === "bold" ? 700 : 500,
    box: "solid",
    boxFill: light ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.6)",
    textColor: light ? "#18181b" : "#ffffff",
    emColor: light ? "#b45309" : "#ffd24a",
    radiusRel: 0,
    outline: false,
  };
}

export function resolveCaptionRecipe(sub: SubtitleSettings, presetId?: string): CaptionRecipe {
  const base = defaultRecipe(sub);
  switch (presetId) {
    // 강조박스 — 노란 박스 + 검은 굵은 글씨(예능 강조). 강조어는 딥레드.
    case "accent":
      return {
        ...base,
        font: "sans",
        weight: 700,
        box: "solid",
        boxFill: "#f2c200",
        textColor: "#1a1400",
        emColor: "#c1121f",
        radiusRel: 0.16,
        outline: false,
      };
    // 감성명조 — 명조체 + 반투명 어두운 박스(가독성). 인용·감성 씬.
    case "serif":
      return {
        ...base,
        font: "serif",
        weight: 500,
        box: "solid",
        boxFill: "rgba(0,0,0,0.5)",
        textColor: "#ffffff",
        emColor: "#ffd24a",
        radiusRel: 0.14,
        outline: false,
      };
    // 말풍선 — 흰 알약형 박스 + 검은 글씨. 대사·코멘트.
    case "bubble":
      return {
        ...base,
        font: "sans",
        weight: 500,
        box: "solid",
        boxFill: "rgba(255,255,255,0.94)",
        textColor: "#18181b",
        emColor: "#c1121f",
        radiusRel: 1.2,
        outline: false,
      };
    // 손글씨 — 나눔 펜 손글씨 + 반투명 어두운 박스(펜글씨가 얇아 가독성 보강). 감성·코멘트.
    case "hand":
      return {
        ...base,
        font: "hand",
        weight: 500,
        box: "solid",
        boxFill: "rgba(0,0,0,0.5)",
        textColor: "#ffffff",
        emColor: "#ffd24a",
        radiusRel: 0.16,
        outline: false,
      };
    // ── ani-cliché 장식 프리셋 (화려한 무료 글꼴) ──
    // 임팩트 — 블랙한산스, 박스 없이 굵고 크게 + 헤일로(MV 타이틀 느낌).
    case "impact":
      return {
        ...base,
        font: "impact",
        weight: 700,
        box: "none",
        boxFill: "transparent",
        textColor: "#ffffff",
        emColor: "#ffd24a",
        radiusRel: 0,
        outline: true,
      };
    // 감성세리프 — 송명체(얇은 스타일리시 세리프) + 반투명 박스. 로맨스 감성.
    case "romance":
      return {
        ...base,
        font: "romance",
        weight: 500,
        box: "solid",
        boxFill: "rgba(0,0,0,0.42)",
        textColor: "#ffffff",
        emColor: "#ffd24a",
        radiusRel: 0.12,
        outline: false,
      };
    // 붓글씨 — 나눔 붓 + 반투명 어두운 박스. 극적인 손맛.
    case "brush":
      return {
        ...base,
        font: "brush",
        weight: 500,
        box: "solid",
        boxFill: "rgba(0,0,0,0.5)",
        textColor: "#ffffff",
        emColor: "#ffd24a",
        radiusRel: 0.16,
        outline: false,
      };
    // 발랄 — 주아(둥근 발랄체) + 흰 알약 박스. 코믹·발랄.
    case "jua":
      return {
        ...base,
        font: "jua",
        weight: 500,
        box: "solid",
        boxFill: "rgba(255,255,255,0.94)",
        textColor: "#18181b",
        emColor: "#c1121f",
        radiusRel: 1.2,
        outline: false,
      };
    // 복고 — 기랑해랑(복고 개성체) + 어두운 박스.
    case "retro":
      return {
        ...base,
        font: "retro",
        weight: 500,
        box: "solid",
        boxFill: "rgba(0,0,0,0.5)",
        textColor: "#ffe9a8",
        emColor: "#ff7aa8",
        radiusRel: 0.16,
        outline: false,
      };
    default:
      return base;
  }
}
