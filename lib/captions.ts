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

// 천 단위 콤마·소수점을 분할에서 잠시 빼두기 위한 보호 센티넬(본문에 안 나오는 제어문자).
const NUM_COMMA = String.fromCharCode(1);
const NUM_DOT = String.fromCharCode(2); // 소수점(0.7) — 문장 끝 마침표로 오인 방지

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

// 문장·콤마로도 안 나뉘는 긴 한 덩어리를 폭(budget) 안에서 강제로 쪼갠다.
// 공백 있는 언어는 어절 단위, 없는 언어(CJK)는 글자 단위 그리디. (잘림 방지 — 텍스트는 안 버림)
function hardWrap(s: string, budget: number): string[] {
  const hasSpace = s.includes(" ");
  const toks = hasSpace ? s.split(/\s+/).filter(Boolean) : [...s];
  const sep = hasSpace ? " " : "";
  const out: string[] = [];
  let cur = "";
  for (const tok of toks) {
    const merged = cur ? cur + sep + tok : tok;
    if (cur && estWidth(merged) > budget) {
      out.push(cur);
      cur = tok;
    } else {
      cur = merged;
    }
  }
  if (cur) out.push(cur);
  return out;
}

// 한 "줄"(수동 줄바꿈으로 나뉜 단위)을 자동 분할해 캡션 배열로.
function segmentLine(line: string, budget: number): string[] {
  const t = line.replace(/\s+/g, " ").trim();
  if (!t) return [];
  // 천 단위 콤마(1,000)·소수점(0.7)은 절/문장 경계가 아니다 → 센티넬로 보호 후 분할, 끝에 복원.
  const safe = t
    .replace(/(\d),(?=\d)/g, "$1" + NUM_COMMA)
    .replace(/(\d)\.(?=\d)/g, "$1" + NUM_DOT);

  // 1차: 문장부호(.!?…)에서만 끊는다. 콤마(나열·절)로는 안 끊어 "사과, 배"를 보존.
  const sentences = (safe.match(/[^.!?…]+[.!?…]?/g) ?? [safe])
    .map((u) => u.trim())
    .filter(Boolean);
  // 2차: 한 문장이 캡션 1컷 용량을 넘을 때만(어쩔 수 없을 때) 콤마에서 더 쪼갠다.
  const units: string[] = [];
  for (const s of sentences) {
    const pieces =
      estWidth(s) <= budget
        ? [s]
        : (s.match(/[^,、]+[,、]?/g) ?? [s]).map((u) => u.trim()).filter(Boolean);
    // 콤마로도 안 나뉘는 긴 덩어리는 폭 기준으로 또 쪼갠다 — "두 줄 넘으면 자동 wrap".
    for (const p of pieces) {
      if (estWidth(p) <= budget) units.push(p);
      else units.push(...hardWrap(p, budget));
    }
  }

  // 3차: 용량 안에서 그리디로 합친다(센티넬은 콤마와 폭이 같아 그대로 측정).
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
  // 보호했던 숫자 콤마 복원, 끝의 절 쉼표는 떼고, 양끝 공백 정리.
  return caps
    .map((c) =>
      c.split(NUM_COMMA).join(",").split(NUM_DOT).join(".").replace(/[,、]\s*$/, "").trim()
    )
    .filter(Boolean);
}

export function segmentCaptions(text: string, size: SubSize = "medium"): string[] {
  const raw = (text ?? "").trim();
  if (!raw) return [];
  const budget = BUDGET[size] ?? BUDGET.medium;
  // 수동 줄바꿈(Enter) = 캡션 강제 경계. 줄마다 자동 분할 후 순서대로 이어붙인다.
  const caps: string[] = [];
  for (const line of raw.split(/\r?\n+/)) caps.push(...segmentLine(line, budget));
  return caps;
}
