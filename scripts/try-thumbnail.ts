// 썸네일 생성을 직접 돌려 본다 — 어디서 실패하는지 보려고(프로젝트 저장 없음).
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/try-thumbnail.ts
import { buildThumbnails } from "../lib/thumbnailGen";

async function main() {
  const pkg = await buildThumbnails({
    projectId: "dry-thumb",
    title: "SK하이닉스가 HBM에 올인한 사이, DDR5에 생긴 일!",
    titlePromise: "HBM 생산에 몰리면 왜 일반 DDR5 값까지 오르는 걸까?",
    firstSegmentTopic: "HBM은 반도체를 쌓아 대역폭을 키운 메모리. 범용 DRAM 생산이 줄어 값이 올랐다.",
    thumbnailText: "메모리 왜 올랐나?",
    styleProfileId: "realistic",
    quality: "medium",
  });
  pkg.variants.forEach((v, i) => {
    console.log(`${i + 1}. ${v.composition}`);
    console.log(`   파일: ${v.fileUrl ?? "(실패)"} / 획 ${v.strokePx ?? "-"}`);
  });
  console.log(JSON.stringify(pkg.screening, null, 2));
}
main().catch((e) => {
  console.error("실패:", e instanceof Error ? e.message : e);
  process.exit(1);
});
