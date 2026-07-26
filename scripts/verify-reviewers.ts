// 대본 검수기 · 롱폼 검수기(닫힌 채점표)를 실제 프로젝트로 한 번 돌려본다 — 저장은 하지 않는다.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/verify-reviewers.ts <쇼츠projectId> <롱폼projectId>
// 쇼츠 id 를 생략하면 최근 프로젝트에서 8씬짜리를 하나 골라 쓴다.
import { getProject, listRecentProjects, getProjectsBulk } from "../lib/projectStore";
import { reviewScript } from "../lib/scriptReview";
import { reviewLongform, assembleReviewText } from "../lib/longformReview";

async function pickShorts(): Promise<string | null> {
  const ids = await listRecentProjects(40);
  const projects = await getProjectsBulk(ids);
  const hit = projects.find((p) => p.format !== "long" && (p.scenes?.length ?? 0) >= 7);
  return hit?.id ?? null;
}

async function main() {
  const shortsId = (process.argv[2] ?? "").trim() || (await pickShorts());
  const longformId = (process.argv[3] ?? "").trim();

  if (shortsId) {
    const p = await getProject(shortsId);
    const narrations = (p?.scenes ?? []).map((s) => s.narration ?? "");
    console.log(`\n══ 대본 검수 — ${p?.title} (${narrations.length}씬)`);
    const r = await reviewScript({ projectId: shortsId, narrations });
    console.log(`  pass: ${r.pass}`);
    console.log(`  총평: ${r.diagnosisSummary}`);
    console.log(`  위반 ${r.violations.length}건:`);
    r.violations.forEach((v) => console.log(`    · ${v}`));
    console.log(`  수정 제안 씬: ${r.revisedScenes.filter((s) => s.changed).map((s) => s.scene).join(", ") || "없음"}`);
    console.log(`  고리 지도 ${r.loopMap.length}줄 / 비용 $${r.costUsd.toFixed(4)}`);
  } else {
    console.log("쇼츠 프로젝트를 못 찾았어요 — id 를 인자로 주세요");
  }

  if (longformId) {
    const lf = await getProject(longformId);
    const pkg = lf?.longformScript;
    if (!lf || !pkg) {
      console.log(`\n롱폼 대본이 없어요: ${longformId}`);
      return;
    }
    const segIds = lf.sourceProjectIds ?? [];
    const segs = await getProjectsBulk(segIds);
    const byId = new Map(segs.map((s) => [s.id, s]));
    const input = {
      topic: lf.longformTitle?.finalTitle ?? lf.title,
      openingLines: [pkg.opening.blockAHook, pkg.opening.blockBRoadmapLanding].filter(Boolean),
      segments: segIds.map((id, i) => {
        const s = byId.get(id);
        const full = (s?.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ");
        return { title: s?.title ?? `세그먼트 ${i + 1}`, summary: full.slice(0, 2000) };
      }),
      connectors: pkg.bridges.map((b) => ({
        after: b.afterSegment,
        text: [b.emphasis, b.elevation, b.opening].filter(Boolean).join(" "),
      })),
      closingLines: [pkg.ending.partAClose, pkg.ending.partBLanding, pkg.ending.partCStandard].filter(Boolean),
      declaredLoop: lf.opening?.openLoop ?? null,
    };
    console.log(`\n══ 롱폼 검수 — ${lf.title}`);
    console.log(`  (입력 마무리 ${input.closingLines.length}줄)`);
    const r = await reviewLongform({ projectId: longformId, input });
    console.log(`  pass: ${r.pass}`);
    console.log(`  총평: ${r.diagnosisSummary}`);
    console.log(`  위반 ${r.violations.length}건:`);
    r.violations.forEach((v) => console.log(`    · ${v}`));
    console.log(`  오프닝 수정: ${r.revisedOpening ? r.revisedOpening.join(" | ") : "없음"}`);
    console.log(`  연결 수정: ${r.revisedConnectors.map((c) => `${c.after}:${c.revised}`).join(" | ") || "없음"}`);
    console.log(`  마무리 수정 ${r.revisedClosing?.length ?? 0}줄: ${r.revisedClosing?.join(" | ") ?? "없음"}`);
    console.log(`  순서 제안: ${r.suggestedOrder ? r.suggestedOrder.join(",") : "없음"} / 비용 $${r.costUsd.toFixed(4)}`);
    if (process.env.SHOW_INPUT === "1") console.log(`\n--- 검수 입력\n${assembleReviewText(input)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
