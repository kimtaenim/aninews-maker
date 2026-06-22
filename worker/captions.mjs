// 자막 캡션 분할 — lib/captions.ts 와 동일 알고리즘(둘을 항상 같이 수정).
// 긴 나레이션을 문장/절 경계로 쪼개 각 캡션이 화면 ~2줄에 들어가게 그리디로 합친다.
// 글씨 크기(작게56/보통68/크게84)에 맞춘 캡션 1개 가로 용량(≈2줄). 작을수록 더 잘게.
// 천 단위 콤마(숫자 사이, 예: 1,000)는 절 경계가 아니므로 끊지 않는다.
const BUDGET = { small: 28, medium: 23, large: 18 };

// 천 단위 콤마를 분할에서 잠시 빼두기 위한 보호 센티넬(본문에 안 나오는 제어문자).
const NUM_COMMA = String.fromCharCode(1);

function estWidth(s) {
  let w = 0;
  for (const ch of s) {
    w += /[ᄀ-ᇿ⺀-꓏가-힣豈-﫿︰-﹏＀-￯]/.test(ch) ? 1 : ch === " " ? 0.4 : 0.5;
  }
  return w;
}

export function segmentCaptions(text, size = "medium") {
  const t = (text ?? "").trim().replace(/\s+/g, " ");
  if (!t) return [];
  const budget = BUDGET[size] ?? BUDGET.medium;
  // 천 단위 콤마(숫자 사이)는 절 경계가 아니다 → 센티넬로 보호 후 분할, 끝에 복원.
  const safe = t.replace(/(\d),(?=\d)/g, "$1" + NUM_COMMA);
  const units = (safe.match(/[^.!?…,、]+[.!?…,、]?/g) ?? [safe])
    .map((u) => u.split(NUM_COMMA).join(",").trim())
    .filter(Boolean);
  const caps = [];
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
  return caps.map((c) => c.replace(/[,、]\s*$/, "").trim()).filter(Boolean);
}
