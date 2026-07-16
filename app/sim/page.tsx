import Link from "next/link";
import { getSimGamesBulk, listSimGameIds } from "@/lib/simStore";
import type { SimGame } from "@/lib/types";
import DeleteGameButton from "./DeleteGameButton";

export const runtime = "nodejs";
export const dynamic = "force-dynamic"; // 항상 최신 목록(Redis)

// 🎮 시뮬 제조기 — 만든 게임 목록. 게임 = 클리셰 인물들과 대화하며 친밀도를
// 올려 고백을 받아내는 미니 연애 시뮬. 제조는 /sim/new.
export default async function SimHomePage() {
  let games: SimGame[] = [];
  let loadError = false;
  try {
    games = await getSimGamesBulk(await listSimGameIds());
  } catch {
    loadError = true;
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">🎮 시뮬 제조기</h1>
        <Link href="/" className="text-sm text-zinc-500 hover:underline">
          ← 홈
        </Link>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        클리셰 영상의 인물을 연애 상대로 데려와 대화형 미니 게임을 만듭니다.
        친밀도를 올리면 만들어둔 심쿵 장면이 컷씬으로 재생돼요.
      </p>

      <Link
        href="/sim/new"
        className="mt-5 block rounded-2xl bg-accent hover:bg-accent-strong text-white font-semibold px-5 py-4 text-center transition-colors"
      >
        + 새 게임 만들기
      </Link>

      {loadError && (
        <p className="mt-6 text-sm text-red-500">
          목록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.
        </p>
      )}

      <ul className="mt-6 grid gap-3">
        {games.map((g) => (
          <li
            key={g.id}
            className="relative rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4"
          >
            <DeleteGameButton gameId={g.id} title={g.title} />
            <div className="pr-8">
              <div className="font-medium">{g.title}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {g.targets.map((t) => (
                  <span
                    key={t.name}
                    className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 pl-1 pr-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-400"
                  >
                    {t.portraitUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.portraitUrl}
                        alt={t.name}
                        className="h-5 w-5 rounded-full object-cover"
                      />
                    ) : (
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-[10px]">
                        {t.name.slice(0, 1)}
                      </span>
                    )}
                    {t.name}
                    {t.archetype ? ` · ${t.archetype}` : ""}
                    {t.cutscenes.length > 0 ? ` · 컷씬 ${t.cutscenes.length}` : ""}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs text-zinc-500">
                  {new Date(g.createdAt).toLocaleDateString("ko-KR")}
                </span>
                <Link
                  href={`/sim/${g.id}/play`}
                  className="rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5 text-xs font-medium transition-colors"
                >
                  ▶ 플레이
                </Link>
              </div>
            </div>
          </li>
        ))}
        {!loadError && games.length === 0 && (
          <li className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">
            아직 만든 게임이 없어요. 완성된 클리셰 프로젝트가 있다면 바로 만들 수 있어요.
          </li>
        )}
      </ul>
    </main>
  );
}
