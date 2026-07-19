// ============================================================================
// 영상 포맷(세로 숏폼 ↔ 가로 롱폼)의 단일 원천.
// ----------------------------------------------------------------------------
// Project.format 하나가 이미지 생성 크기·워커 합성 해상도·fal 영상 비율·UI 종횡비
// 클래스를 전부 결정한다. 세로 고정으로 하드코딩돼 있던 값들을 여기로 모은다.
//   short: 세로 9:16 (기존 기본). format 없으면 이걸로 본다(무회귀).
//   long : 가로 16:9 (롱폼).
// gpt-image-2 는 가로·세로가 둘 다 16의 배수여야 한다(lib/openai.ts 참고).
//   1008x1792 = 9:16, 1792x1008 = 16:9 (둘 다 16 배수).
// 1920x1080 과 1080x1920 은 픽셀 수가 같아 합성 인코딩 부하도 사실상 동일.
// ============================================================================

export type VideoFormat = "short" | "long";

export interface FormatDims {
  format: VideoFormat;
  W: number; // 합성 캔버스 가로 (worker)
  H: number; // 합성 캔버스 세로 (worker)
  imageSize: string; // gpt-image-2 size ("가로x세로")
  videoAspect: string; // fal aspect_ratio
  aspectClass: string; // Tailwind 종횡비 클래스 (UI)
}

const SHORT: FormatDims = {
  format: "short",
  W: 1080,
  H: 1920,
  imageSize: "1008x1792",
  videoAspect: "9:16",
  aspectClass: "aspect-[9/16]",
};

const LONG: FormatDims = {
  format: "long",
  W: 1920,
  H: 1080,
  imageSize: "1792x1008",
  videoAspect: "16:9",
  aspectClass: "aspect-[16/9]",
};

// format 값 정규화 — 없거나 이상하면 short(기존 기본).
export function toVideoFormat(format?: string | null): VideoFormat {
  return format === "long" ? "long" : "short";
}

export function formatDims(format?: string | null): FormatDims {
  return toVideoFormat(format) === "long" ? LONG : SHORT;
}
