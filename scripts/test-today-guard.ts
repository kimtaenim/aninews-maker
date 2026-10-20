// 오늘 날짜 주입 문구 검증 — LLM 무관 순수함수.
//   실행: npx tsx scripts/test-today-guard.ts
//
// 2026년 10월 카드뉴스의 날짜를 2025년 9월로 고쳐 쓴 사고의 재발 방지.
// 본문을 다시 쓰는 호출이 이 문구를 실제로 품고 있는지까지 본다.
import { readFile } from "node:fs/promises";
import { todayISO, todayGuard } from "../lib/today";

let fail = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(ok ? "  ✓" : "  ✗", label, ok ? "" : `→ ${detail ?? ""}`);
  if (!ok) fail++;
};

console.log("[오늘 날짜]");
{
  const iso = todayISO();
  check("YYYY-MM-DD 형식", /^\d{4}-\d{2}-\d{2}$/.test(iso), iso);
  const d = new Date();
  const expect = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
  check("실제 오늘과 일치", iso === expect, `${iso} vs ${expect}`);
  check("연도가 올해", iso.startsWith(String(d.getFullYear())), iso);
}

console.log("\n[주입 문구]");
{
  const g = todayGuard();
  check("오늘 날짜가 들어 있다", g.includes(todayISO()), g.slice(0, 40));
  check("지식이 더 오래됐다고 알린다", g.includes("오래됐다"));
  check("원문 날짜를 그대로 두라고 못 박는다", g.includes("그대로 옮긴다"));
  check("없는 날짜를 만들지 말라고 한다", g.includes("만들어 넣지 마라"));
  check("기억과 어긋나도 원문을 따르라고 한다", g.includes("원문을 따른다"));
}

async function main() {
  console.log("\n[본문을 다시 쓰는 호출에 실제로 붙어 있는가]");
  for (const [file, label] of [
    ["lib/script.ts", "대본 생성"],
    ["lib/stepChat.ts", "소스·스크립트 대화"],
    ["lib/mergeSources.ts", "꼭지 종합"],
  ] as const) {
    const src = await readFile(file, "utf8");
    check(`${label} (${file})`, src.includes("todayGuard"), "todayGuard 호출이 없음");
  }

  console.log(fail === 0 ? "\n전부 통과" : `\n실패 ${fail}건`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
