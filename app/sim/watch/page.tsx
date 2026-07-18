import Link from "next/link";
import {
  getSimGamesBulk,
  getSimPlaysBulk,
  listRecentPlayIds,
} from "@/lib/simStore";
import { getSessionEmail } from "@/lib/auth";
import type { SimGame, SimPlay } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 항상 최신(Redis)

// 👀 구경하기 / 📔 내 기록 — 플레이 결과와 대화를 본다. ?mine=1 이면 내 것만.
export default async function SimWatchPage({
  searchParams,
}: {
  searchParams: Promise<{ mine?: string }>;
}) {
  const mine = (await searchParams).mine === "1";
  const email = (await getSessionEmail()) ?? undefined;
  let plays: SimPlay[] = [];
  let games = new Map<string, SimGame>();
  let loadError = false;
  try {
    plays = await getSimPlaysBulk(await listRecentPlayIds(mine ? 200 : 40));
    if (mine) plays = plays.filter((p) => (p.ownerEmail ?? "") === (email ?? ""));
    const gameIds = [...new Set(plays.map((p) => p.gameId))];
    const gs = await getSimGamesBulk(gameIds);
    games = new Map(gs.map((g) => [g.id, g]));
  } catch {
    loadError = true;
  }

  const label = (p: SimPlay) =>
    p.status === "won"
      ? { text: "💖 성공", cls: "bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400" }
      : p.status === "lost"
        ? { text: "💔 실패", cls: "bg-slate-100 dark:bg-slate-800 text-slate-500" }
        : { text: "💬 진행 중", cls: "bg-zinc-100 dark:bg-zinc-800 text-zinc-500" };

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">
          {mine ? "📔 내 기록" : "👀 구경하기"}
        </h1>
        <Link href="/sim" className="text-sm text-zinc-500 hover:underline">
          ← 시뮬 제조기
        </Link>
      </div>
      {/* 전체 ↔ 내 것만 토글 */}
      <div className="mt-3 flex gap-2">
        <Link
          href="/sim/watch"
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            !mine
              ? "bg-accent text-white"
              : "border border-zinc-200 dark:border-zinc-800 text-zinc-500"
          }`}
        >
          전체
        </Link>
        <Link
          href="/sim/watch?mine=1"
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            mine
              ? "bg-accent text-white"
              : "border border-zinc-200 dark:border-zinc-800 text-zinc-500"
          }`}
        >
          내 기록
        </Link>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        다른 사람들이 누구와 어떻게 대화했는지 구경해요. 카드를 누르면 전체 대화를 볼 수 있어요.
      </p>

      {loadError && (
        <p className="mt-6 text-sm text-red-500">불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>
      )}

      <ul className="mt-6 grid gap-3">
        {plays.map((p) => {
          const g = games.get(p.gameId);
          const turns = p.turns.filter((t) => t.role === "user").length;
          const lastNpc = [...p.turns].reverse().find((t) => t.role === "assistant");
          const lb = label(p);
          return (
            <li key={p.id}>
              <Link
                href={`/sim/watch/${p.id}`}
                className="block rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {p.targetName}
                    <span className="ml-2 text-xs font-normal text-zinc-500">
                      {g?.title ?? "(삭제된 게임)"}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${lb.cls}`}>
                    {lb.text}
                  </span>
                </div>
                {lastNpc && (
                  <p className="mt-2 line-clamp-1 text-sm text-zinc-500">“{lastNpc.text}”</p>
                )}
                <div className="mt-2 text-xs text-zinc-400">
                  {turns}턴 · {new Date(p.updatedAt).toLocaleDateString("ko-KR")}
                </div>
              </Link>
            </li>
          );
        })}
        {!loadError && plays.length === 0 && (
          <li className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">
            아직 플레이 기록이 없어요. 먼저 한 판 해보면 여기 올라와요.
          </li>
        )}
      </ul>
    </main>
  );
}
