import Link from "next/link";
import { listSimTheaterIds, getSimTheatersBulk } from "@/lib/simTheaterStore";
import type { SimTheater } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 저장된 AI 자동극장 목록 — 이어보기·새로 만들기.
export default async function TheaterListPage() {
  let theaters: SimTheater[] = [];
  let loadError = false;
  try {
    theaters = await getSimTheatersBulk(await listSimTheaterIds());
  } catch {
    loadError = true;
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight">🎭 AI 자동극장</h1>
        <Link href="/sim" className="text-sm text-zinc-500 hover:underline">
          ← 시뮬
        </Link>
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        인물 2~3명을 상황에 넣고 AI끼리 대화(연애·다툼)시키며 ‘다음’으로 관전합니다.
        만든 극장은 저장돼서 언제든 이어볼 수 있어요.
      </p>
      <p className="mt-2 rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
        ⚠️ 주의: AI 자동극장(관전 모드)은 인물끼리 대화를 주고받는 모드라 토큰 비용이 많이
        올라갈 수 있습니다.
      </p>

      <Link
        href="/sim/theater/new"
        className="mt-4 block rounded-2xl bg-accent hover:bg-accent-strong text-white font-semibold px-5 py-4 text-center transition-colors"
      >
        + 새 극장 만들기
      </Link>

      {loadError && (
        <p className="mt-6 text-sm text-red-500">목록을 불러오지 못했어요. 잠시 후 새로고침해 주세요.</p>
      )}

      <ul className="mt-6 grid gap-3">
        {theaters.map((t) => (
          <li key={t.id} className="rounded-2xl border border-zinc-200 dark:border-zinc-800 p-4">
            <div className="font-medium">{t.title}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {t.cast.map((c) => (
                <span
                  key={c.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 dark:border-zinc-800 pl-1 pr-2.5 py-0.5 text-xs text-zinc-600 dark:text-zinc-400"
                >
                  {c.portraitUrl || c.faces?.neutral ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.faces?.neutral || c.portraitUrl}
                      alt={c.name}
                      className="h-5 w-5 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-[10px]">
                      {c.name.slice(0, 1)}
                    </span>
                  )}
                  {c.name}
                  {c.archetype ? ` · ${c.archetype}` : ""}
                </span>
              ))}
            </div>
            {t.situation && (
              <div className="mt-2 line-clamp-2 text-xs text-zinc-500">🎬 {t.situation}</div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-500">
                {t.turns.length}턴 · {new Date(t.updatedAt).toLocaleDateString("ko-KR")}
              </span>
              <Link
                href={`/sim/theater/${t.id}`}
                className="rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5 text-xs font-medium transition-colors"
              >
                ▶ {t.turns.length > 0 ? "이어보기" : "시작"}
              </Link>
            </div>
          </li>
        ))}
        {!loadError && theaters.length === 0 && (
          <li className="rounded-2xl border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center text-sm text-zinc-500">
            아직 만든 극장이 없어요. 위 ‘새 극장 만들기’로 시작하세요.
          </li>
        )}
      </ul>
    </main>
  );
}
