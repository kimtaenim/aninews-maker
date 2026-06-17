// 자막 캡션 분할 — lib/captions.ts 와 동일 알고리즘(둘을 항상 같이 수정).
// 긴 나레이션을 문장/절 경계로 쪼개 각 캡션이 화면 ~2줄에 들어가게 그리디로 합친다.
// 글씨 크기(작게56/보통68/크게84)에 맞춘 캡션 1개 가로 용량(≈2줄). 작을수록 더 잘게.
const BUDGET = { small: 28, medium: 23, large: 18 };

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
  const units = (t.match(/[^.!?…,、]+[.!?…,、]?/g) ?? [t]).map((u) => u.trim()).filter(Boolean);
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
