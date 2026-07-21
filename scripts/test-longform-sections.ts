// 롱폼 섹션 분할 단위 테스트 — LLM 무관 순수함수 검증.
//   실행: npx tsx scripts/test-longform-sections.ts
import { sectionSizes, buildSections } from "../lib/longform";

let fail = 0;

function eq(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? "  ✓" : "  ✗", label, "→", JSON.stringify(got), ok ? "" : `(기대: ${JSON.stringify(want)})`);
  if (!ok) fail++;
}

console.log("[sectionSizes — 각 섹션 2~3, 합=n]");
eq("n=2", sectionSizes(2), [2]);
eq("n=3", sectionSizes(3), [3]);
eq("n=4", sectionSizes(4), [2, 2]);
eq("n=5", sectionSizes(5), [3, 2]);
eq("n=6", sectionSizes(6), [3, 3]);
eq("n=7", sectionSizes(7), [3, 2, 2]);
eq("n=10", sectionSizes(10), [3, 3, 2, 2]);
eq("n=12", sectionSizes(12), [3, 3, 3, 3]);

console.log("\n[불변식 — n=2..30 은 모든 섹션이 2~3, 합=n]");
for (let n = 2; n <= 30; n++) {
  const sizes = sectionSizes(n);
  const sum = sizes.reduce((a, b) => a + b, 0);
  const allValid = sizes.every((s) => s === 2 || s === 3);
  const ok = sum === n && allValid;
  if (!ok) {
    console.log("  ✗", `n=${n}`, JSON.stringify(sizes), `합=${sum}`);
    fail++;
  }
}
console.log("  ✓ n=2..30 불변식 통과(위에 ✗ 없으면 OK)");

console.log("\n[buildSections — segmentIds 순서·분할 보존]");
const ids = Array.from({ length: 10 }, (_, i) => `seg${i}`);
const secs = buildSections(ids);
eq("섹션 수(n=10)", secs.length, 4);
eq("섹션 크기", secs.map((s) => s.segmentIds.length), [3, 3, 2, 2]);
eq(
  "이어붙이면 원래 순서",
  secs.flatMap((s) => s.segmentIds),
  ids
);
eq("각 섹션 status=pending", secs.every((s) => s.status === "pending"), true);
eq("각 섹션 id 고유", new Set(secs.map((s) => s.id)).size, secs.length);

console.log(fail === 0 ? "\n✅ 전부 통과" : `\n❌ 실패 ${fail}건`);
process.exit(fail === 0 ? 0 : 1);
