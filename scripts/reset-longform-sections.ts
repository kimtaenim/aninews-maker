// 롱폼 섹션 합성 캐시를 비워 다시 굽게 한다(옛 URL 은 videoUrlBackup 으로 보존).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/reset-longform-sections.ts <longformId>
import { getProject, saveProject } from "../lib/projectStore";

async function main() {
  const id = (process.argv[2] ?? "").trim();
  if (!id) throw new Error("longformId 필요");
  const p = await getProject(id);
  if (!p) throw new Error("프로젝트 없음");
  const sections = p.sections ?? [];
  if (!sections.length) throw new Error("섹션이 없어요");
  for (const sec of sections) {
    if (!sec.videoUrl) continue;
    sec.videoUrlBackup = sec.videoUrl;
    sec.videoUrl = undefined;
    sec.status = "pending";
    sec.updatedAt = Date.now();
    console.log("섹션 캐시 비움:", sec.id);
  }
  p.updatedAt = Date.now();
  await saveProject(p);
  console.log("저장 완료 — 이제 최종 합성을 다시 걸면 섹션부터 새로 굽습니다.");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
