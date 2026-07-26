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
