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

// ── 본문 텍스트 ──────────────────────────────────────────────────────────────
// 본문 문장 끝에 붙는 근거 표시 [F-001] — 낭독·자막엔 들어가면 안 되므로 렌더 전에 지운다.
// 화면(글자 수 표시)과 서버(생성·검수)가 같은 규칙을 써야 해서 여기 둔다.
export const CARD_REF = /\s*\[(F-\d{3}(?:\s*,\s*F-\d{3})*)\]/g;

export function stripCardRefs(body: string): string {
  return (body ?? "").replace(CARD_REF, "").replace(/[ \t]+\n/g, "\n").trim();
}

/** 본문에서 인용한 카드 id 들. */
export function citedCardIds(body: string): string[] {
  const out = new Set<string>();
  for (const m of (body ?? "").matchAll(CARD_REF)) {
    for (const id of m[1].split(",")) out.add(id.trim());
  }
  return [...out];
}

/** 낭독 글자 수 — 근거 표시·강조 마크업을 뺀 실제 나레이션 기준. */
export function bodyChars(body: string): number {
  return stripCardRefs(body).replace(/\[\[|\]\]/g, "").replace(/\s+/g, " ").trim().length;
}

/**
 * 배수가 크면 원본이 차지하는 비중이 작아진다 — 본문의 대부분을 새로 찾은 사실로 채워야 하고,
 * 모델이 분량을 채우려고 카드에 없는 숫자를 지어낸다(실측: 7배에서 카드 밖 숫자 5건).
 * 원본 비중(%)과 권장 초과 여부를 같이 돌려준다. 차단이 아니라 화면 경고용.
 */
export function stretchWarning(
  sourceSec: number,
  targetSec: number,
  maxMultiplier: number
): { over: boolean; times: number; sourceShare: number } {
  const times = multiplier(sourceSec, targetSec);
  const share = times > 0 ? Math.round((1 / times) * 100) : 0;
  return { over: times > maxMultiplier, times, sourceShare: share };
}

export const won = (n: number) => `₩${n.toLocaleString("ko-KR")}`;
export const wonRange = (r: [number, number]) =>
  r[0] === r[1] ? won(r[0]) : `${won(r[0])}~${won(r[1])}`;
