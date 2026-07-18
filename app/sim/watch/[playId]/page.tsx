import Link from "next/link";
import { getSimGame, getSimPlay } from "@/lib/simStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 읽기전용 대화 뷰어 — 남의 플레이 한 판을 처음부터 끝까지 구경(입력 없음).
export default async function SimWatchDetailPage({
  params,
}: {
  params: Promise<{ playId: string }>;
}) {
  const { playId } = await params;
  const play = await getSimPlay(playId);

  if (!play) {
    return (
      <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
        <p className="text-sm text-red-500">이 플레이 기록을 찾을 수 없어요.</p>
        <Link href="/sim/watch" className="mt-4 inline-block text-sm text-zinc-500 hover:underline">
          ← 구경하기
        </Link>
      </main>
    );
  }
  const game = await getSimGame(play.gameId);

  const status =
    play.status === "won"
      ? { emoji: "💖", text: "이어졌다" }
      : play.status === "lost"
        ? { emoji: "💔", text: "여기까지" }
        : { emoji: "💬", text: "진행 중" };

  return (
    <main className="px-4 py-6 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-base font-semibold tracking-tight">
          {play.targetName}
          <span className="ml-2 text-xs font-normal text-zinc-500">
            {game?.title ?? "(삭제된 게임)"}
          </span>
        </h1>
        <Link href="/sim/watch" className="text-sm text-zinc-500 hover:underline">
          ← 구경
        </Link>
      </div>

      {/* 최종 좋음·싫음 (숫자 없이 바만) */}
      <div className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span>{status.emoji}</span>
          <span>{status.text}</span>
        </div>
        <div className="mt-3 space-y-1">
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-rose-500">좋음</span>
            <div className="h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500"
                style={{ width: `${play.like}%` }}
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-8 shrink-0 text-[10px] text-slate-500">싫음</span>
            <div className="h-2 flex-1 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-slate-400 to-slate-600"
                style={{ width: `${play.dislike}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 대화 전체 */}
      <div className="mt-4 space-y-2">
        {play.turns.map((t, i) => (
          <div
            key={i}
            className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                t.role === "user"
                  ? "bg-accent text-white"
                  : t.sulking
                    ? "bg-red-50 dark:bg-red-950/30 border border-red-200/60 dark:border-red-900/40"
                    : "bg-zinc-100 dark:bg-zinc-800"
              }`}
            >
              {t.text}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-center text-xs text-zinc-400">
        읽기 전용 · 남의 플레이 기록
      </p>
    </main>
  );
}
