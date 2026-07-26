// 비판 검수가 실제로 몇 초 걸리는지 잰다 — Vercel maxDuration 300초 상한 진단용(저장 없음).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/verify-critique-timing.ts <projectId>
// 라운드별 시간 · 구조화(2차 호출) 시간 · 총 시간을 찍는다.
import { getProject } from "../lib/projectStore";
import { critiqueScript, extractCritiqueFixes } from "../lib/scriptCritique";

async function main() {
  const projectId = (process.argv[2] ?? "").trim();
  if (!projectId) throw new Error("사용법: verify-critique-timing.ts <projectId>");
  const p = await getProject(projectId);
  if (!p?.scenes?.length) throw new Error("대본이 없어요");
  const narrations = p.scenes.map((s) => s.narration);
  console.log(`[${p.title}] ${narrations.length}씬 / 글자 ${narrations.join("").length}자`);

  const t0 = Date.now();
  const r = await critiqueScript({
    projectId,
    narrations,
    imagesReady: p.scenes.some((s) => !!s.imageUrl),
    skipExtract: true, // 리포트 시간만 따로 잰다
    onRound: (i) =>
      console.log(`  라운드 ${i.round}: ${(i.ms / 1000).toFixed(1)}초 / stop=${i.stopReason} / 검색=${i.searched}`),
  });
  const reportMs = Date.now() - t0;
  console.log(`\n리포트: ${(reportMs / 1000).toFixed(1)}초 / 검색 ${r.searched} / 중단 ${r.partial} / ${r.report.length}자`);

  const t1 = Date.now();
  const ex = await extractCritiqueFixes({ projectId, report: r.report });
  const exMs = Date.now() - t1;
  console.log(`구조화: ${(exMs / 1000).toFixed(1)}초 / 항목 ${ex.fixes.length}건 / 총평: ${ex.verdict}`);

  const total = (reportMs + exMs) / 1000;
  console.log(`\n합계 ${total.toFixed(1)}초 — Vercel 상한 300초 ${total > 300 ? "★초과(분리 필요)" : `여유 ${(300 - total).toFixed(0)}초`}`);
  console.log(`비용 $${(r.costUsd + ex.costUsd).toFixed(4)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
