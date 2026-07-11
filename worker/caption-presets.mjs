// 자막 스타일 프리셋 — lib/captionPresets.ts 와 동일 로직(둘을 항상 같이 수정).
// 프로젝트 자막 설정의 위치·크기·정렬은 두고 폰트·박스·색·모서리·외곽선만 덮어쓴다.

function defaultRecipe(sub) {
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

export function resolveCaptionRecipe(sub, presetId) {
  const base = defaultRecipe(sub);
  switch (presetId) {
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
