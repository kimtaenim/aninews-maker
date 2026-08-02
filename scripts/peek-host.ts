// 진행자 프로젝트 목소리·자산 상태 확인(읽기 전용).
//   npx tsx -r dotenv/config scripts/peek-host.ts <hostId> <segId>
import { getProject } from "../lib/projectStore";

async function main() {
  const host = await getProject((process.argv[2] ?? "").trim());
  const seg = await getProject((process.argv[3] ?? "").trim());
  console.log("세그 목소리:", seg?.ttsProvider, seg?.voiceId, seg?.voiceSpeed);
  console.log("진행자 목소리:", host?.ttsProvider, host?.voiceId, host?.voiceSpeed);
  for (const s of host?.scenes ?? []) {
    console.log(
      s.index,
      s.hostSlot,
      s.imageUrl ? "🖼" : "·",
      s.videoUrl ? "🎬" : "·",
      s.audioUrl ? "🔊" : "·",
      (s.narration ?? "").slice(0, 24)
    );
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
