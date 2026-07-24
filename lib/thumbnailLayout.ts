// ============================================================================
// [롱폼 모듈 5] 썸네일 문구 배치 계산 — 네이티브 모듈 없이 도는 순수 계산부.
// ----------------------------------------------------------------------------
// 제목 생성기(모듈 1)도 "이 문구가 작게 줄었을 때 읽히나"를 여기서 판정한다. 그래서
// @napi-rs/canvas 를 import 하는 thumbnailCompose 와 분리해 둔다.
//
// 판정 기준은 글자 수가 아니라 "모바일 검색 결과 폭(168px)에서 글자 획이 남는가"다.
// 문구가 길면 글자가 작아지고, 어느 지점부터는 몇 자든 안 읽힌다 — 그 지점이 진짜 상한.
// ============================================================================

export const THUMB_W = 1280;
export const THUMB_H = 720;
export const PREVIEW_W = 168; // 모바일 검색 결과에서 썸네일이 보이는 폭
export const PREVIEW_H = Math.round((THUMB_H / THUMB_W) * PREVIEW_W); // 95

const TARGET_BLOCK_W = 640; // 글자 블록이 차지할 가로(캔버스의 약 50%)
const MAX_FONT = 260;
// Black Han Sans 의 획(스템) 두께 ≈ 0.12em. 168px 로 줄었을 때 2px 이상 남아야 읽힌다.
const STEM_RATIO = 0.12;
export const MIN_STROKE_AT_168 = 2;
export const MIN_READABLE_FONT = Math.ceil(MIN_STROKE_AT_168 / (STEM_RATIO * (PREVIEW_W / THUMB_W))); // ≈127

export function strokeAt168(fontSize: number): number {
  return Math.round(fontSize * STEM_RATIO * (PREVIEW_W / THUMB_W) * 100) / 100;
}

export interface TextLayout {
  lines: string[]; // 1~2줄
  sizes: number[]; // 줄별 글자 크기
  readable: boolean; // 168px 축소본에서 읽히는가
  strokePx: number; // 168px 기준 획 두께 추정
}

// 문구를 1~2줄로 나눈다. 두 줄이면 윗줄이 핵심 단어(더 크게).
// 공백이 없으면 반으로 쪼개고, 덩어리가 셋 이상이면 길이가 균형 잡히게 두 줄로 묶는다.
// (한 줄로 길게 두면 글자가 작아져 소형 판독에서 먼저 죽는다.)
function splitLines(text: string): string[] {
  const words = (text ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  if (words.length === 1) {
    const w = words[0];
    if (w.length <= 5) return [w];
    const cut = Math.ceil(w.length / 2);
    return [w.slice(0, cut), w.slice(cut)];
  }
  if (words.length === 2) return words;
  // 3덩어리 이상 — 두 줄 길이 차가 가장 작아지는 지점에서 자른다.
  let best = 1;
  let bestGap = Infinity;
  for (let k = 1; k < words.length; k++) {
    const a = words.slice(0, k).join(" ").length;
    const b = words.slice(k).join(" ").length;
    const gap = Math.abs(a - b);
    if (gap < bestGap) {
      bestGap = gap;
      best = k;
    }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

export function layoutText(text: string): TextLayout {
  const lines = splitLines(text);
  const maxChars = Math.max(1, ...lines.map((l) => l.length));
  const size = Math.round(Math.min(MAX_FONT, TARGET_BLOCK_W / maxChars));
  const sizes = lines.length === 2 ? [size, Math.round(size * 0.78)] : [size];
  return {
    lines,
    sizes,
    readable: size >= MIN_READABLE_FONT,
    strokePx: strokeAt168(size),
  };
}

// 모듈 1이 쓰는 판정 — 이 문구를 썸네일에 얹으면 168px 에서 읽히는가.
export function readableAt168(text: string): { ok: boolean; strokePx: number; fontSize: number } {
  const l = layoutText(text);
  return { ok: l.readable, strokePx: l.strokePx, fontSize: l.sizes[0] };
}
