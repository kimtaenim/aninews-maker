// ============================================================================
// 제목 banned 규칙 검사 — 순수 함수(LLM 무관, 단위 테스트 대상).
// ----------------------------------------------------------------------------
// 제목 생성기(titleGen)가 후보 검증·재시도에 쓰고, scripts/test-title-banned.ts 가 검증한다.
// 기계적으로 잡히는 위반만 검사한다("정보 없는 분류 꼬리" 같은 판단형은 LLM 몫).
// ============================================================================

const TECH_WORDS = ["AI", "로봇", "코인", "메타버스", "블록체인", "NFT", "메타"];
const LESSON = ["알기 쉬운", "쉽게 풀이", "하는 법", "하는법", "총정리", "완벽 가이드", "완벽가이드", "정리"];
const LOSS = ["폭락", "위기", "망했다", "망한", "손실"];

// 위반한 규칙 라벨 목록 반환(빈 배열 = 통과).
export function violatesBanned(title: string): string[] {
  const t = (title ?? "").trim();
  const v: string[] = [];
  if (!t) return v;

  // 물결표(~)
  if (t.includes("~")) v.push("물결표(~)");

  // 시점 표현 — N월 / N일 / 최근·요즘·올해·이번 주·지난주·다음 주
  if (/\d+\s*월/.test(t) || /\d+\s*일/.test(t) || /(최근|요즘|올해|이번\s*주|지난\s*주|다음\s*주)/.test(t)) {
    v.push("시점 표현");
  }

  // 기술어가 첫 어절
  const first = t.split(/\s+/)[0] ?? "";
  if (TECH_WORDS.some((w) => first.startsWith(w))) v.push("기술어 선두");

  // 수업 예고
  if (LESSON.some((w) => t.includes(w))) v.push("수업 예고");

  // 손실·불안 어휘
  if (LOSS.some((w) => t.includes(w))) v.push("손실·불안 어휘");

  // "AI" 단독 타이틀(사실상 AI만)
  if (/^AI[\s!?.]*$/i.test(t)) v.push("AI 단독");

  return v;
}

// 편의 — 통과 여부.
export function isTitleClean(title: string): boolean {
  return violatesBanned(title).length === 0;
}
