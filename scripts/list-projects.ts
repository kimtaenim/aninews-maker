// 최근 프로젝트를 한 줄씩 — id / 씬수 / format / 제목. 검증 대상 고를 때 쓴다(읽기 전용).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/list-projects.ts [개수]
import { listRecentProjects, getProjectsBulk } from "../lib/projectStore";

async function main() {
  const limit = Number(process.argv[2] ?? 30) || 30;
  const ids = await listRecentProjects(limit);
  const projects = await getProjectsBulk(ids);
  for (const p of projects) {
    console.log(
      `${p.id}  씬 ${String(p.scenes?.length ?? 0).padStart(2)}  ${(p.format ?? "short").padEnd(5)}  ${p.title}`
    );
  }
  console.log(`\n${projects.length}개 / 요청 ${ids.length}개`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
