// 비판 검수 리포트 → 체크박스 항목(CritiqueFix[]) 추출만 따로 검증.
// 웹 검색 없이 실제 리포트 텍스트 파일 하나로 돌린다(빠르고 저렴).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/test-critique-extract.ts <report.txt>
import { readFileSync } from "node:fs";
import { getAnthropic, MODELS } from "../lib/anthropic";
import { EXTRACT_INSTRUCTION, parseFixes } from "../lib/scriptCritique";

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("리포트 텍스트 파일 경로 필요");
  const report = readFileSync(path, "utf8");
  console.log(`리포트 ${report.length}자 · 추출 시작…`);

  const r = await getAnthropic().messages.create({
    model: MODELS.sonnet,
    max_tokens: 8000,
    system: "너는 검수 리포트를 구조화된 JSON 으로 옮겨 적는 변환기다. JSON 만 출력한다.",
    messages: [{ role: "user", content: `[검수 리포트]\n${report}\n\n${EXTRACT_INSTRUCTION}` }],
  });
  const raw = (r.content as { type: string; text?: string }[])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
  const { fixes, verdict } = parseFixes(raw);

  console.log("verdict:", verdict || "(없음)");
  console.log(`fixes: ${fixes.length}건\n`);
  for (const f of fixes) {
    console.log(
      `[${f.severity}] ${f.plan}안 · ${f.kind === "insert" ? `씬 ${f.scene} 뒤 추가` : `씬 ${f.scene} 수정`}` +
        `${f.image ? ` · 그림 ${f.image}` : ""}${f.grade ? ` · ${f.grade}` : ""}`
    );
    if (f.issue) console.log(`   문제: ${f.issue}`);
    if (f.original) console.log(`   원문: ${f.original.slice(0, 70)}`);
    console.log(`   수정: ${f.revised.slice(0, 90)}`);
    if (f.sources?.length) console.log(`   근거: ${f.sources.length}개`);
    console.log();
  }
  if (fixes.length === 0) {
    console.log("!! 추출 0건 — 원본 응답 앞부분:\n" + raw.slice(0, 800));
  }
}
main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
