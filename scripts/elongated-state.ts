// 확장판 상태 훑어보기 — 설계/사실/본문이 어디까지 찼는지.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/elongated-state.ts <projectId>
import { getProject } from "../lib/projectStore";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("projectId 를 인자로 주세요");
  const p = await getProject(id);
  const t = p?.elongated;
  if (!t) throw new Error("확장판이 아니에요");
  const plan = t.plan;
  console.log(`제목: ${p!.title}`);
  console.log(`목표: ${t.targetSec}초 / 원본 ${t.sourceSeconds}초`);
  console.log(`사실 카드: ${t.facts.length}건 (재확인 필요 ${t.facts.filter((f) => f.expires).length})`);
  if (!plan) return console.log("설계 없음");
  console.log(`설계: 챕터 ${plan.chapters.length} · 승인 ${plan.approvedAt ? "O" : "X"}`);
  for (const c of plan.chapters) {
    const done = c.blocks.filter((b) => b.searchedAt).length;
    const body = (c.body ?? "").trim();
    console.log(
      `  ${c.index}. ${c.title} — 대목 ${c.blocks.length}(찾음 ${done}) · 본문 ${body ? `${body.length}자` : "없음"}`
    );
    for (const b of c.blocks) {
      console.log(
        `      ${b.enabled ? "O" : "X"} ${b.type}: 카드 ${b.factIds.length}${b.missing ? ` · ⚠ ${b.missing.slice(0, 40)}` : ""}${b.searchedAt ? "" : " · 미검색"}`
      );
    }
  }
}
main();
