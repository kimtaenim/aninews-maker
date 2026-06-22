// ============================================================================
// 자막 캡션 분할 — 긴 나레이션을 "한 번에 보여줄 캡션"들로 나눈다.
// 미리보기(ScenePreview)와 워커(compose)가 같은 결과를 쓰도록 동일 알고리즘을
// worker/captions.mjs 에도 복제한다. 둘을 항상 같이 수정할 것.
// ----------------------------------------------------------------------------
// 규칙: 문장(.!?…)·절(,) 경계로 쪼갠 뒤, 각 캡션이 화면 ~2줄에 들어갈 만큼만
// 그리디로 합친다. 폭은 CJK=1, 그 외=0.5 의 근사 단위로 계산.
// 천 단위 콤마(숫자 사이, 예: 1,000)는 절 경계가 아니므로 끊지 않는다.
// ============================================================================

export type SubSize = "small" | "medium" | "large";

// 글씨 크기(작게56/보통68/크게84)에 맞춘 캡션 1개 가로 용량(≈2줄). 작을수록 더 잘게.
const BUDGET: Record<SubSize, number> = { small: 28, medium: 23, large: 18 };

// 천 단위 콤마를 분할에서 잠시 빼두기 위한 보호 센티넬(본문에 안 나오는 제어문자).
const NUM_COMMA = String.fromCharCode(1);

function estWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    w += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch)
      ? 1
      : ch === " "
        ? 0.4
        : 0.5;
  }
  return w;
}

export function segmentCaptions(text: string, size: SubSize = "medium"): string[] {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  if (!t) return [];
  const budget = BUDGET[size] ?? BUDGET.medium;
  // 천 단위 콤마(숫자 사이)는 절 경계가 아니다 → 센티넬로 보호 후 분할, 끝에 복원.
  const safe = t.replace(/(\d),(?=\d)/g, "$1" + NUM_COMMA);
  // 문장부호(.!?…) 또는 절 쉼표(,、) 뒤에서 끊어 "단위" 들로.
  const units = (safe.match(/[^.!?…,、]+[.!?…,、]?/g) ?? [safe])
    .map((u) => u.split(NUM_COMMA).join(",").trim())
    .filter(Boolean);

  const caps: string[] = [];
  let cur = "";
  for (const u of units) {
    const merged = cur ? cur + " " + u : u;
    if (cur && estWidth(merged) > budget) {
      caps.push(cur);
      cur = u;
    } else {
      cur = merged;
    }
  }
  if (cur) caps.push(cur);
  // 표시용으로 끝의 절 쉼표는 떼고, 양끝 공백 정리.
  return caps.map((c) => c.replace(/[,、]\s*$/, "").trim()).filter(Boolean);
}
