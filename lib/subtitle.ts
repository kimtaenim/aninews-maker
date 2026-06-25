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
  // 세로 위치는 인라인 스타일로 — Tailwind 임의값 클래스(top-[8%] 등) 생성/캐시에
  // 의존하지 않아, 값을 바꾸면 미리보기에 바로 반영된다.
  containerPos: { top?: string; bottom?: string };
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
    // 위치별 세로 배치(미리보기 근사). 합성(worker)은 박스 중심을 해당 지점에 둔다.
    containerPos:
      s.position === "top"
        ? { top: "8%" }
        : s.position === "center"
          ? { top: "44%" }
          : s.position === "two-thirds"
            ? { top: "62%" }
            : s.position === "three-quarters"
              ? { top: "72%" }
              : { bottom: "10%" },
  };
}
