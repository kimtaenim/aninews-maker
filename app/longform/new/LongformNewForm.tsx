"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ShortItem {
  id: string;
  title: string;
  keyframeUrl?: string;
}

const MAX_PICK = 30; // lib/longform.ts MAX_SEGMENTS 와 같은 값

// 숏폼을 클릭한 순서대로 선택(번호 부여). 다시 클릭하면 해제. 2~30편.
// 검색은 API(/api/projects/search)로 목록만 갈아끼운다 — 서버 렌더 ?q= 로 하면
// 검색할 때마다 고른 순서가 날아가기 때문. 고른 것은 항상 상단에 고정해 보여준다.
export default function LongformNewForm({ shorts }: { shorts: ShortItem[] }) {
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();

  // 목록 · 검색
  const [items, setItems] = useState<ShortItem[]>(shorts);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchInfo, setSearchInfo] = useState("");
  const [searchErr, setSearchErr] = useState("");
  // 고른 항목은 검색 결과에서 사라져도 상단 스트립에 남아야 하므로 따로 들고 있는다.
  const picked = useRef<Map<string, ShortItem>>(new Map());
  useEffect(() => {
    for (const s of items) if (order.includes(s.id)) picked.current.set(s.id, s);
  }, [items, order]);

  const toggle = (id: string) =>
    setOrder((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= MAX_PICK ? cur : [...cur, id]
    );
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? null : i + 1;
  };
  const pickedItem = (id: string): ShortItem =>
    picked.current.get(id) ?? items.find((s) => s.id === id) ?? { id, title: "(제목 없음)" };

  async function runSearch(nextQ: string) {
    setSearching(true);
    setSearchErr("");
    try {
      const r = await fetch(
        `/api/projects/search?kind=bundle&limit=200&q=${encodeURIComponent(nextQ.trim())}`
      );
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "검색 실패");
      setItems(d.items ?? []);
      setSearchInfo(
        nextQ.trim()
          ? `'${nextQ.trim()}' 검색 결과 ${d.total}개 (전체 ${d.scanned}개 대상 — 옛날 것 포함)`
          : ""
      );
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setSearching(false);
    }
  }

  const submit = async () => {
    if (order.length < 2) {
      setErr("2편 이상 골라주세요");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/longform", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shortIds: order }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "묶기 실패");
      router.push(`/project/${d.longformId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "묶기 실패");
      setBusy(false);
    }
  };

  return (
    <div className="mt-4">
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/90 dark:bg-zinc-950/90 backdrop-blur border-b border-zinc-100 dark:border-zinc-900">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm text-zinc-600 dark:text-zinc-300">{order.length}편 선택</span>
          <div className="flex items-center gap-2">
            {order.length > 0 && (
              <button
                onClick={() => setOrder([])}
                className="text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                선택 해제
              </button>
            )}
            <button
              onClick={submit}
              disabled={busy || order.length < 2}
              className="text-sm font-medium rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white px-4 py-1.5"
            >
              {busy ? "묶는 중…" : `롱폼으로 묶기 (${order.length})`}
            </button>
          </div>
        </div>

        {/* 고른 순서 — 검색으로 목록이 바뀌어도 여기 남는다. 칩을 누르면 해제. */}
        {order.length > 0 && (
          <ul className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {order.map((id, i) => {
              const s = pickedItem(id);
              return (
                <li key={id} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => toggle(id)}
                    title={`${s.title} — 누르면 해제`}
                    className="flex items-center gap-1 rounded-full border border-accent bg-accent/10 pl-1.5 pr-2 py-1 text-[11px] text-accent hover:bg-accent/20"
                  >
                    <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
                      {i + 1}
                    </span>
                    <span className="max-w-[9rem] truncate">{s.title}</span>
                    <span className="text-zinc-400">✕</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* 검색 — 제목·나레이션(스크립트) 부분일치. 라이브러리와 같은 규칙. */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(q);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="제목·나레이션으로 검색 (예: 환율, 휴머노이드)"
          className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          disabled={searching}
          className="shrink-0 rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium px-4"
        >
          {searching ? "검색 중…" : "검색"}
        </button>
        {(q || searchInfo) && (
          <button
            type="button"
            onClick={() => {
              setQ("");
              runSearch("");
            }}
            className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            전체
          </button>
        )}
      </form>
      {searchInfo && <p className="mt-2 text-xs text-zinc-500">{searchInfo}</p>}
      {searchErr && <p className="mt-2 text-xs text-red-600">{searchErr}</p>}
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">
          {searchInfo ? "검색 결과가 없어요." : "완성된 숏폼이 없어요. 먼저 숏폼을 완성해 주세요."}
        </p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {items.map((s) => {
            const r = rank(s.id);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => toggle(s.id)}
                  className={`block w-full text-left rounded-2xl border overflow-hidden transition-colors ${
                    r
                      ? "border-accent ring-2 ring-accent"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-accent"
                  }`}
                >
                  <div className="relative aspect-[9/16] bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
                    {s.keyframeUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.keyframeUrl} alt={s.title} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[11px] text-zinc-400">미생성</span>
                    )}
                    {r && (
                      <span className="absolute inset-0 flex items-center justify-center">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-accent/90 text-white text-3xl font-extrabold shadow-lg ring-2 ring-white/70">
                          {r}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="p-2 text-xs font-medium line-clamp-2 leading-snug">{s.title}</p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
