// 비판 검수 lib 전체 체인 검증(웹 검색 → 2부 리포트). 브라우저·인증 우회.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/test-critique.ts <projectId>
import { Redis } from "@upstash/redis";
import { critiqueScript } from "../lib/scriptCritique";

async function main() {
  const id = process.argv[2] || "ac900744-707b-4144-8c39-48001b2210fa";
  const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
  const p = (await redis.get(`project:${id}`)) as { scenes?: { narration: string; imageUrl?: string }[] } | null;
  if (!p?.scenes?.length) throw new Error("no scenes");
  const narrations = p.scenes.map((s) => s.narration);
  const imagesReady = p.scenes.some((s) => !!s.imageUrl);
  console.log(`씬 ${narrations.length}개 · 그림완성=${imagesReady} · 검수 시작…`);
  const r = await critiqueScript({ projectId: id, narrations, imagesReady });
  console.log("searched:", r.searched, "| costUsd:", r.costUsd.toFixed(4));
  console.log("===== REPORT =====");
  console.log(r.report);
}
main().catch((e) => {
  console.error("ERROR:", e?.message || e);
  process.exit(1);
});
