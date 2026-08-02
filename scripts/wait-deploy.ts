// 푸시한 커밋이 프로덕션에 실제로 떴는지 확인한다 — "배포했습니다"는 이게 통과한 뒤에만.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/wait-deploy.ts [기다릴초]
import { execSync } from "child_process";
import { prodApi } from "./prod-api";

async function main() {
  const head = execSync("git rev-parse HEAD").toString().trim();
  const maxSec = Number(process.argv[2] ?? 300) || 300;
  const start = Date.now();
  process.stdout.write(`HEAD ${head.slice(0, 7)} 대기`);
  while ((Date.now() - start) / 1000 < maxSec) {
    try {
      const r = await prodApi("GET", "/api/health");
      const sha = ((r.json ?? {}) as { sha?: string }).sha ?? "";
      if (sha === head) {
        console.log(`\n✓ 배포 확인 — ${sha.slice(0, 7)} (${Math.round((Date.now() - start) / 1000)}초)`);
        return;
      }
      process.stdout.write(sha ? ` [${sha.slice(0, 7)}]` : " .");
    } catch {
      process.stdout.write(" x");
    }
    await new Promise((res) => setTimeout(res, 15_000));
  }
  console.log(`\n✗ ${maxSec}초 안에 안 떴어요 — 배포 실패이거나 아직 빌드 중. Vercel 대시보드 확인 필요`);
  process.exit(1);
}
main();
