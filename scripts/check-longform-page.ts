// 배포된 롱폼 페이지에 새 재생 순서 작업판이 반영됐는지 확인(읽기 전용).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/check-longform-page.ts <longformId>
import { prodApi } from "./prod-api";

async function main() {
  const id = (process.argv[2] ?? "").trim();
  if (!id) throw new Error("사용법: check-longform-page.ts <longformId>");
  const r = await prodApi("GET", `/project/${id}`);
  console.log(`HTTP ${r.status} / ${r.text.length}자`);
  const marks = [
    "재생 순서",
    "제작 도구",
    "진행자 말 저장",
    "진행자 씬 다시 펼치기",
    "오프닝 1",
    "엔딩 여운",
    "씬 편집",
  ];
  for (const m of marks) {
    const n = r.text.split(m).length - 1;
    console.log(`  ${n > 0 ? "✓" : "✗"} ${m} — ${n}회`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
