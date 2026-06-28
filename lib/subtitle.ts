// ============================================================================
// 자막 설정 → 미리보기 스타일 변환 (클라이언트 안전, 서버 import 없음)
// ----------------------------------------------------------------------------
// 최종 번인(worker/ffmpeg)도 같은 SubtitleSettings 를 읽어 동일하게 렌더한다.
// 미리보기는 1080폭 합성과 "같은 비율"이 되도록 폰트·패딩·최대폭을 컨테이너폭(cqw)
// 단위로 돌려준다(ScenePreview 가 프레임을 container 로 만들어 cqw 를 해석). 그래야
// 화면 크기와 무관하게 미리보기≈최종이 된다.
// ============================================================================

import type { SubtitleSettings } from "./types";

export interface SubtitleStyle {
  fontFamily: string;
  weightClass: string;
  boxClass: string;
  alignClass: string;
  // 워커 fontPx(작게56/보통68/크게84) @1080폭 → 컨테이너폭 대비 %(cqw). 패딩·최대폭도
  // 이 값에 비례(워커: padX=0.45·padY=0.28·lineH=1.3, maxBoxW=91%)시켜 비율을 맞춘다.
  fontCqw: number;
  // 세로 위치(인라인). 워커 boxY 와 동일: 중간 위치(⅓·중앙·⅔·¾)는 박스 "중심"을 그
  // 지점에(transform 으로 앵커), 상단은 위 9%, 하단은 바닥에서 10%.
  containerPos: { top?: string; bottom?: string; transform?: string };
}

// 워커(subtitle-image.mjs)와 동일 비율: fontPx 56/68/84 @ W=1080.
function fontCqwFor(size: SubtitleSettings["size"]): number {
  const px = size === "small" ? 56 : size === "large" ? 84 : 68;
  return (px / 1080) * 100; // %단위(cqw)
}

export function resolveSubtitleStyle(s: SubtitleSettings): SubtitleStyle {
  return {
    fontFamily:
      s.font === "serif"
        ? "var(--font-noto-serif-kr), 'Noto Serif KR', serif"
        : "var(--font-noto-sans-kr), sans-serif",
    weightClass: s.weight === "bold" ? "font-bold" : "font-medium",
    boxClass: s.box === "light" ? "bg-white/85 text-zinc-900" : "bg-black/60 text-white",
    alignClass: s.align === "left" ? "text-left" : "text-center",
    fontCqw: fontCqwFor(s.size),
    containerPos:
      s.position === "top"
        ? { top: "9%" }
        : s.position === "one-third"
          ? { top: "33.3%", transform: "translateY(-50%)" }
          : s.position === "center"
            ? { top: "50%", transform: "translateY(-50%)" }
            : s.position === "two-thirds"
              ? { top: "66.6%", transform: "translateY(-50%)" }
              : s.position === "three-quarters"
                ? { top: "75%", transform: "translateY(-50%)" }
                : { bottom: "10%" },
  };
}
