// 롱폼 진행자 대본을 실제로 재생성해 눈으로 검증한다 — 저장은 하지 않는다(읽기 전용).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/verify-longform-script.ts <longformProjectId>
// 목적: 투자 조언 금지(d0c911a) 이후 엔딩 여운이 실제로 비는지, 종목 추천이 안 섞이는지 확인.
import { getProject, getProjectsBulk } from "../lib/projectStore";
import { generateLongformScript } from "../lib/longformScript";
import { screenScript } from "../lib/longformScreening";
import type { LongformConstituent } from "../lib/longformTitleGen";

async function main() {
  const projectId = (process.argv[2] ?? "").trim();
  if (!projectId) throw new Error("사용법: verify-longform-script.ts <longformProjectId>");

  const longform = await getProject(projectId);
  if (!longform) throw new Error(`프로젝트 없음: ${projectId}`);
  const segIds = longform.sourceProjectIds ?? [];
  const finalTitle = longform.longformTitle?.finalTitle?.trim();
  const titlePromise = longform.longformTitle?.titlePromise?.trim();
  console.log(`[롱폼] ${longform.title}`);
  console.log(`  확정 제목: ${finalTitle || "(없음)"}`);
  console.log(`  title_promise: ${titlePromise || "(없음)"}`);
  console.log(`  세그먼트 ${segIds.length}편`);
  if (!finalTitle || !titlePromise) throw new Error("제목 확정(finalTitle/titlePromise)이 없어요");

  // app/api/longform/script/route.ts 의 구성원 조립과 동일하게 맞춘다.
  const segProjects = await getProjectsBulk(segIds);
  const byId = new Map(segProjects.map((s) => [s.id, s]));
  const SEG_TOTAL_BUDGET = 60_000;
  const perSeg = Math.min(3000, Math.max(900, Math.floor(SEG_TOTAL_BUDGET / Math.max(1, segIds.length))));
  const constituents: LongformConstituent[] = segIds
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => {
      const full = (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ");
      return {
        title: s.title,
        topic: full.length > perSeg ? `${full.slice(0, perSeg)}…(이하 생략)` : full,
        segmentId: s.id,
      };
    });
  constituents.forEach((c, i) => console.log(`   ${i}: ${c.title} (소재 ${c.topic.length}자)`));

  const { pkg, violations, costUsd } = await generateLongformScript({
    projectId,
    input: {
      title: finalTitle,
      titlePromise,
      viewerPayoff: "구성 편들의 핵심을 한 번에 이해한다",
      constituents,
    },
  });

  const show = (label: string, t: string) =>
    console.log(`  ${label} (${t.length}자): ${t || "(빈칸)"}`);
  console.log("\n─── 오프닝");
  show("1씬", pkg.opening.blockAHook);
  show("2씬", pkg.opening.blockBRoadmapLanding);
  console.log("\n─── 연결");
  pkg.bridges.forEach((b, i) => {
    const t = [b.emphasis, b.elevation, b.opening].filter(Boolean).join(" / ");
    console.log(`  ${i + 1}${b.isMidpointReopen ? " (중간점 환기)" : ""} (${t.length}자): ${t}`);
  });
  console.log("\n─── 엔딩");
  show("답", pkg.ending.partAClose);
  show("여운", pkg.ending.partBLanding);
  show("구독", pkg.ending.partCStandard);
  console.log("\n─── 세그먼트 순서");
  pkg.segmentOrder.forEach((s) => console.log(`  ${s.order}. ${s.title} — ${s.rationale}`));

  const screen = screenScript(pkg, constituents.length);
  console.log(`\n검수 위반: ${violations.length === 0 ? "없음" : JSON.stringify(violations, null, 2)}`);
  console.log(`오프닝 ${screen.openingSeconds}초 / 엔딩 ${screen.endingSeconds}초`);
  console.log(`여운 비었나: ${pkg.ending.partBLanding.trim() === "" ? "예(원칙대로)" : "아니오 ← 내용 확인 필요"}`);
  console.log(`비용 $${costUsd.toFixed(4)} (저장은 하지 않았음)`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
