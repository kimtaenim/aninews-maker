// 비용 실측 — Redis 의 cost:entries 를 meta.kind 별로 집계한다.
//   $env:DOTENV_CONFIG_PATH=".env.local"; npx tsx -r dotenv/config scripts/cost-by-kind.ts
import { getRedis } from "../lib/redis";
import { KRW_PER_USD } from "../lib/cost";
import type { CostEntry } from "../lib/types";

async function main() {
  const entries = (await getRedis().lrange<CostEntry>("cost:entries", 0, -1)) ?? [];
  const byKind = new Map<string, number[]>();
  for (const e of entries) {
    const kind = String((e.meta as Record<string, unknown> | undefined)?.kind ?? `(${e.vendor}/${e.model})`);
    if (!byKind.has(kind)) byKind.set(kind, []);
    byKind.get(kind)!.push(e.costUsd ?? 0);
  }
  const rows = [...byKind.entries()]
    .map(([kind, xs]) => {
      const sorted = [...xs].sort((a, b) => a - b);
      const sum = xs.reduce((a, b) => a + b, 0);
      return {
        kind,
        n: xs.length,
        avg: sum / xs.length,
        median: sorted[Math.floor(sorted.length / 2)],
        max: sorted[sorted.length - 1],
        sum,
      };
    })
    .sort((a, b) => b.sum - a.sum);

  console.log("kind".padEnd(28), "n".padStart(4), "평균".padStart(10), "중앙".padStart(10), "최대".padStart(10));
  for (const r of rows) {
    const krw = (u: number) => `₩${Math.round(u * KRW_PER_USD).toLocaleString("ko-KR")}`;
    console.log(
      r.kind.padEnd(28),
      String(r.n).padStart(4),
      krw(r.avg).padStart(10),
      krw(r.median).padStart(10),
      krw(r.max).padStart(10)
    );
  }
}
main();
