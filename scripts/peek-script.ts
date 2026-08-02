// 저장된 롱폼 대본·진행자 씬을 그대로 본다(읽기 전용).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/peek-script.ts <longformId>
import { getProject } from "../lib/projectStore";

async function main() {
  const id = (process.argv[2] ?? "").trim();
  const lf = await getProject(id);
  if (!lf) throw new Error("프로젝트 없음");
  const p = lf.longformScript;
  if (!p) {
    console.log("대본 없음");
    return;
  }
  console.log("오프닝1:", JSON.stringify(p.opening.blockAHook));
  console.log("오프닝2:", JSON.stringify(p.opening.blockBRoadmapLanding));
  p.bridges.forEach((b, i) =>
    console.log(`연결${i + 1}:`, JSON.stringify([b.emphasis, b.elevation, b.opening].filter(Boolean).join(" / ")))
  );
  console.log("엔딩답:", JSON.stringify(p.ending.partAClose));
  console.log("여운:", JSON.stringify(p.ending.partBLanding));
  console.log("구독:", JSON.stringify(p.ending.partCStandard));
  console.log("--- 진행자 씬");
  const host = lf.hostProjectId ? await getProject(lf.hostProjectId) : null;
  if (!host) {
    console.log("진행자 프로젝트 없음");
    return;
  }
  for (const s of host.scenes ?? []) {
    console.log(s.index, s.hostSlot ?? "?", s.connectorAfter ?? "", JSON.stringify((s.narration ?? "").slice(0, 42)));
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
