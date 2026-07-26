// 프로젝트 씬 상태 한 줄씩 — 이미지/영상/오디오가 있는지(읽기 전용).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/scene-state.ts <projectId>
import { getProject } from "../lib/projectStore";

async function main() {
  const id = (process.argv[2] ?? "").trim();
  const p = await getProject(id);
  if (!p) throw new Error(`프로젝트 없음: ${id}`);
  console.log(`[${p.title}] format=${p.format} videoModelId=${p.videoModelId ?? "(기본)"}`);
  console.log(
    `steps: ${Object.entries(p.steps ?? {})
      .map(([k, v]) => `${k}=${(v as { status?: string })?.status ?? "?"}`)
      .join(" ")}`
  );
  (p.scenes ?? []).forEach((s, i) => {
    console.log(
      `  ${String(i).padStart(2)} ${s.imageUrl ? "🖼" : "··"} ${s.videoUrl ? "🎬" : s.videoJobId ? "⏳" : "··"} ` +
        `${s.audioUrl ? "🔊" : "··"} ${String(s.durationSec ?? "").padStart(2)}s ${s.hostSlot ?? ""} ${(s.narration ?? "").slice(0, 30)}`
    );
  });
  const noVideo = (p.scenes ?? []).map((s, i) => (s.imageUrl && !s.videoUrl ? i : -1)).filter((i) => i >= 0);
  console.log(`\n이미지는 있고 영상 없는 씬: ${noVideo.join(", ") || "없음"}`);
  if (p.sections) console.log(`sections: ${JSON.stringify(p.sections)}`);
  if (p.sourceProjectIds) console.log(`sourceProjectIds: ${p.sourceProjectIds.join(", ")}`);
  if (p.hostProjectId) console.log(`hostProjectId: ${p.hostProjectId}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exit(1);
});
