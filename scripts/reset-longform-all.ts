// 롱폼 전체 재굽기 준비 — 편 finalVideoUrl + 섹션 videoUrl 캐시를 백업 후 비운다.
// (합성 파이프라인이 바뀌어 모든 층을 새 방식으로 다시 구울 때 사용. 자산(그림·영상·음성)은 안 건드림.)
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/reset-longform-all.ts <longformId>
import { getProject, saveProject } from "../lib/projectStore";

async function main() {
  const id = (process.argv[2] ?? "").trim();
  if (!id) throw new Error("longformId 필요");
  const p = await getProject(id);
  if (!p) throw new Error("프로젝트 없음");
  for (const segId of p.sourceProjectIds ?? []) {
    const seg = await getProject(segId);
    if (!seg || !seg.finalVideoUrl) continue;
    (seg as unknown as Record<string, unknown>).finalVideoUrlBackup = seg.finalVideoUrl;
    seg.finalVideoUrl = undefined;
    seg.updatedAt = Date.now();
    await saveProject(seg);
    console.log("편 완성본 비움:", seg.title.slice(0, 24));
  }
  for (const sec of p.sections ?? []) {
    if (!sec.videoUrl) continue;
    sec.videoUrlBackup = sec.videoUrl;
    sec.videoUrl = undefined;
    sec.status = "pending";
    sec.updatedAt = Date.now();
    console.log("섹션 캐시 비움:", sec.id);
  }
  p.updatedAt = Date.now();
  await saveProject(p);
  console.log("완료 — 최종 합성을 걸면 편부터 전부 새로 굽습니다.");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
