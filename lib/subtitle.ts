// ============================================================================
// 자막 설정 → 미리보기 스타일 변환 (클라이언트 안전, 서버 import 없음)
// ----------------------------------------------------------------------------
// 최종 번인(worker/ffmpeg)도 같은 SubtitleSettings 를 읽어 동일하게 렌더한다.
// ============================================================================

import type { SubtitleSettings } from "./types";

export interface SubtitleStyle {
  fontFamily: string;
  weightClass: string;
  sizeClass: string;
  boxClass: string;
  alignClass: string;
  containerPosClass: string;
}

export function resolveSubtitleStyle(s: SubtitleSettings): SubtitleStyle {
  return {
    fontFamily:
      s.font === "serif"
        ? "var(--font-noto-serif-kr), 'Noto Serif KR', serif"
        : "var(--font-noto-sans-kr), sans-serif",
    weightClass: s.weight === "bold" ? "font-bold" : "font-medium",
    sizeClass:
      s.size === "small"
        ? "text-[11px]"
        : s.size === "large"
          ? "text-[15px]"
          : "text-[13px]",
    boxClass:
      s.box === "light"
        ? "bg-white/85 text-zinc-900"
        : "bg-black/60 text-white",
    alignClass: s.align === "left" ? "text-left" : "text-center",
    // 하단은 더 아래, 상단은 더 위로 (가장자리 가깝게)
    containerPosClass: s.position === "top" ? "top-[3%]" : "bottom-[3%]",
  };
}
