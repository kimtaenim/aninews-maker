import Link from "next/link";
import { getProjectsBulk, listAllProjectIds } from "@/lib/projectStore";
import TheaterNewForm, { type PoolMember } from "./TheaterNewForm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AI 자동극장 만들기 — 클리셰 인물들을 한 풀로 모아 고르고, 직접 추가도 가능.
export default async function TheaterNewPage() {
  let pool: PoolMember[] = [];
  try {
    const projects = await getProjectsBulk(await listAllProjectIds());
    const cliche = projects.filter((p) => p.mode === "cliche");
    const byName = new Map<string, PoolMember>();
    for (const p of cliche) {
      const members = p.castMembers?.length
        ? p.castMembers.map((m) => ({
            name: m.name,
            archetype: m.archetype,
            portraitUrl: m.portraitUrl,
          }))
        : (p.cast ?? []).map((name) => ({ name, archetype: undefined, portraitUrl: undefined }));
      for (const m of members) {
        if (m.name && !byName.has(m.name)) byName.set(m.name, m);
      }
    }
    pool = [...byName.values()];
  } catch {
    /* 풀 로드 실패해도 직접 추가로 만들 수 있게 폼은 띄운다 */
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">🎭 AI 자동극장 만들기</h1>
        <Link href="/sim" className="text-sm text-zinc-500 hover:underline">
          ← 목록
        </Link>
      </div>
      <p className="mt-2 text-sm text-zinc-500">
        인물 2~3명과 상황을 정하면, AI끼리 알아서 대화(연애·다툼)합니다. 당신은 ‘다음’으로
        한 턴씩 넘기며 지켜보고, 중간에 상황을 던져 흐름을 틀 수 있어요.
      </p>
      <TheaterNewForm pool={pool} />
    </main>
  );
}
