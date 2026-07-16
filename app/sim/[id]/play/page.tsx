import Link from "next/link";
import { getSimGame } from "@/lib/simStore";
import PlayClient, { type PlayTarget } from "./PlayClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 시뮬 플레이 화면 — PoC: 상대 하나면 자동 시작, 여럿이면 client 에서 고른다.
export default async function SimPlayPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const game = await getSimGame(id);

  if (!game) {
    return (
      <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
        <p className="text-sm text-red-500">게임을 찾을 수 없어요.</p>
        <Link href="/sim" className="mt-4 inline-block text-sm text-zinc-500 hover:underline">
          ← 게임 목록
        </Link>
      </main>
    );
  }

  const targets: PlayTarget[] = game.targets.map((t) => ({
    name: t.name,
    archetype: t.archetype ?? "",
    portraitUrl: t.portraitUrl ?? "",
    cutsceneCount: t.cutscenes.length,
  }));

  return (
    <main className="px-4 py-6 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold tracking-tight">{game.title}</h1>
        <Link href="/sim" className="text-sm text-zinc-500 hover:underline">
          ← 목록
        </Link>
      </div>
      <PlayClient gameId={game.id} targets={targets} />
    </main>
  );
}
