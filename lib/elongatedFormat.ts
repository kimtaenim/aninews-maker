// ============================================================================
// [확장판] 화면 표기 — 서버·클라이언트가 같이 쓰는 순수 함수만 둔다.
// lib/elongated.ts 는 crypto·projectStore 를 쓰는 서버 모듈이라 클라이언트에서 못 읽는다.
// 표기가 화면마다 갈리지 않도록(“5분 0초” 같은 것) 여기 한 곳에서만 만든다.
// ============================================================================

/** 초 → "1분 9초" / "5분" / "45초". */
export function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (!m) return `${r}초`;
  return r ? `${m}분 ${r}초` : `${m}분`;
}

/** 목표 ÷ 원본(소수 첫째 자리). 원본이 0이면 0. */
export function multiplier(sourceSec: number, targetSec: number): number {
  if (!sourceSec) return 0;
  return Math.round((targetSec / sourceSec) * 10) / 10;
}

// ── 예상 제작비 ──────────────────────────────────────────────────────────────
// 목표 길이를 고르는 순간 편당 비용이 정해진다(8분이면 씬 70개 = 영상비가 대부분).
// 고르기 "전에" 보여야 하므로 클라이언트에서도 계산할 수 있게 여기 둔다.
// 단가는 절대 여기 박지 않는다 — 서버(lib/cost.ts)가 rates 로 넘겨준다.

export interface CostRates {
  videoUsdPerScene: number;
  imageUsd: number;
  voiceUsdPerChar: number;
  scriptUsd: number; // 설계 + 본문 + 검수(대본 단계 전체) 실측 기반
  krwPerUsd: number;
  durationMin: number; // 씬 하나 최소 초
  durationMax: number; // 씬 하나 최대 초
  charsPerSec: number;
}

export interface ElongatedCostEstimate {
  minScenes: number;
  maxScenes: number;
  scriptKrw: number;
  videoKrw: [number, number];
  imageKrw: [number, number];
  voiceKrw: number;
  totalKrw: [number, number];
}

export function estimateCost(targetSec: number, r: CostRates): ElongatedCostEstimate {
  const minScenes = Math.ceil(targetSec / r.durationMax);
  const maxScenes = Math.ceil(targetSec / r.durationMin);
  const krw = (usd: number) => Math.round(usd * r.krwPerUsd);
  const video: [number, number] = [
    krw(minScenes * r.videoUsdPerScene),
    krw(maxScenes * r.videoUsdPerScene),
  ];
  const image: [number, number] = [krw(minScenes * r.imageUsd), krw(maxScenes * r.imageUsd)];
  const script = krw(r.scriptUsd);
  const voice = krw(Math.round(targetSec * r.charsPerSec) * r.voiceUsdPerChar);
  return {
    minScenes,
    maxScenes,
    scriptKrw: script,
    videoKrw: video,
    imageKrw: image,
    voiceKrw: voice,
    totalKrw: [script + video[0] + image[0] + voice, script + video[1] + image[1] + voice],
  };
}

export const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;
export const wonRange = (r: [number, number]) =>
  r[0] === r[1] ? won(r[0]) : `${won(r[0])}~${won(r[1])}`;
