"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface ShortItem {
  id: string;
  title: string;
  keyframeUrl?: string;
}

// 숏폼을 클릭한 순서대로 선택(번호 부여). 다시 클릭하면 해제. 2~12편.
export default function LongformNewForm({ shorts }: { shorts: ShortItem[] }) {
  const [order, setOrder] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();

  const toggle = (id: string) =>
    setOrder((cur) =>
      cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 12 ? cur : [...cur, id]
    );
  const rank = (id: string) => {
    const i = order.indexOf(id);
    return i === -1 ? null : i + 1;
  };

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
      <div className="sticky top-0 z-10 -mx-4 px-4 py-2 bg-white/90 dark:bg-zinc-950/90 backdrop-blur flex items-center justify-between gap-2 border-b border-zinc-100 dark:border-zinc-900">
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

      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}

      {shorts.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-500">완성된 숏폼이 없어요. 먼저 숏폼을 완성해 주세요.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
          {shorts.map((s) => {
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
