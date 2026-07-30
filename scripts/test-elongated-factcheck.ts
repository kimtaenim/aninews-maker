// 팩트 대조 순수 함수 테스트 — 모델·네트워크 없이 돈다.
//   npx tsx scripts/test-elongated-factcheck.ts
// 지시서 검증 항목: "카드 하나를 일부러 지웠을 때 팩트 대조가 잡는가".
import { runFactCheck, extractTokens, norm } from "../lib/elongatedFactCheck";
import type { ElongatedChapter, FactCard } from "../lib/types";

let failed = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) return console.log(`  ✅ ${name}`);
  failed++;
  console.log(`  ❌ ${name}`, detail === undefined ? "" : JSON.stringify(detail));
}

const card = (id: string, fact: string): FactCard => ({
  id,
  fact,
  grade: "보도",
  sourceUrl: "https://example.com/x",
  sourceName: "출처",
  sourceDate: "2026-01-01",
  fetchedAt: "2026-07-26",
  expires: false,
});

const chapter = (body: string): ElongatedChapter => ({
  index: 1,
  title: "테스트",
  sourceSceneIndexes: [0],
  role: "",
  blocks: [],
  body,
});

const FACTS = [
  card("F-001", "1944년 브레턴우즈 회의에서 금 1온스를 35달러에 고정했다."),
  card("F-002", "금값은 온스당 5,594달러에서 3,992달러로 내렸다."),
];
const SOURCE = ["금값이 반년 만에 4분의 1이 빠졌어요."];

console.log("\n[1] 카드에 있는 숫자는 통과");
{
  const items = runFactCheck({
    chapters: [chapter("1944년에 금 1온스를 35달러에 묶었어요. [F-001]")],
    facts: FACTS,
    sourceScenes: SOURCE,
  });
  ok("불일치 0건", items.length === 0, items);
}

console.log("\n[2] 카드에 없는 숫자는 '카드에 없음'");
{
  const items = runFactCheck({
    chapters: [chapter("1944년에 금 1온스를 42달러에 묶었어요. [F-001]")],
    facts: FACTS,
    sourceScenes: SOURCE,
  });
  const hit = items.find((i) => norm(i.token) === norm("42달러"));
  ok("42달러를 잡는다", !!hit, items);
  ok("판정이 '카드에 없음'", hit?.verdict === "카드에 없음", hit?.verdict);
}

console.log("\n[3] 다른 카드에는 있는데 엉뚱한 카드를 인용하면 '카드와 다름'");
{
  const items = runFactCheck({
    chapters: [chapter("금값이 5,594달러에서 내렸어요. [F-001]")],
    facts: FACTS,
    sourceScenes: SOURCE,
  });
  const hit = items.find((i) => norm(i.token).includes("5594"));
  ok("5,594달러를 잡는다", !!hit, items);
  ok("판정이 '카드와 다름'", hit?.verdict === "카드와 다름", hit?.verdict);
}

console.log("\n[4] ★카드를 지우면 잡힌다(지시서 검증 항목)");
{
  const body = "금값은 온스당 5,594달러였어요. [F-002]";
  const before = runFactCheck({ chapters: [chapter(body)], facts: FACTS, sourceScenes: SOURCE });
  ok("카드가 있을 땐 통과", before.length === 0, before);
  const after = runFactCheck({
    chapters: [chapter(body)],
    facts: FACTS.filter((f) => f.id !== "F-002"), // 일부러 삭제
    sourceScenes: SOURCE,
  });
  ok("카드를 지우면 불일치가 잡힌다", after.length > 0, after);
  ok("판정이 '카드에 없음'", after[0]?.verdict === "카드에 없음", after[0]);
}

console.log("\n[5] 원본이 이미 한 말은 카드가 없어도 통과");
{
  const items = runFactCheck({
    chapters: [chapter("금값이 반년 만에 4분의 1이 빠졌어요.")],
    facts: FACTS,
    sourceScenes: SOURCE,
  });
  ok("원본 표현은 통과", items.length === 0, items);
}

console.log("\n[6] 근거 표시가 없는 새 숫자도 잡는다");
{
  const items = runFactCheck({
    chapters: [chapter("작년에는 12만 명이 몰렸어요.")],
    facts: FACTS,
    sourceScenes: SOURCE,
  });
  ok("근거 없는 숫자를 잡는다", items.length > 0, items);
  ok("cardId 가 비어 있다", !items[0]?.cardId, items[0]);
}

console.log("\n[6-2] 근거 표시가 다음 문장 머리로 밀려도 앞 문장 것으로 본다");
{
  const items = runFactCheck({
    chapters: [
      chapter("1944년에 금 1온스를 35달러에 묶었어요. [F-001] 금이 돈의 닻이던 시절이죠."),
    ],
    facts: FACTS,
    sourceScenes: SOURCE,
  });
  ok("불일치 0건", items.length === 0, items);
}

console.log("\n[7] 토큰 추출 — 쉼표·단위·라틴 고유명사");
{
  const t = extractTokens("ASML 이 5,594달러에서 28%가 빠졌어요. [F-002]");
  ok("ASML 을 잡는다", t.some((x) => x === "ASML"), t);
  ok("5,594달러를 잡는다", t.some((x) => norm(x) === "5594달러"), t);
  ok("28% 를 잡는다", t.some((x) => norm(x) === "28%"), t);
  ok("근거 표시 F-002 는 토큰이 아니다", !t.some((x) => /F-002/.test(x)), t);
}

console.log(failed === 0 ? "\n전부 통과\n" : `\n실패 ${failed}건\n`);
process.exit(failed === 0 ? 0 : 1);
