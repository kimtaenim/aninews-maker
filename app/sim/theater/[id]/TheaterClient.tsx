"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

interface Cast {
  name: string;
  archetype: string;
  portraitUrl: string;
  faces?: Record<string, string>;
}
interface Turn {
  speaker: string;
  text: string;
  situation?: string;
}
interface Feeling {
  from: string;
  to: string;
  like: number;
  dislike: number;
}
interface Delta {
  from: string;
  to: string;
  likeDelta: number;
  dislikeDelta: number;
}

const EXPR_IDS = ["smile", "frown", "blush", "sulk"] as const;

export default function TheaterClient({
  theaterId,
  situation,
  cast,
  initialTurns,
  initialFeelings,
  initialNextSpeaker,
  isAdmin = false,
}: {
  theaterId: string;
  title: string;
  situation: string;
  cast: Cast[];
  initialTurns: Turn[];
  initialFeelings: Feeling[];
  initialNextSpeaker: string;
  isAdmin?: boolean;
}) {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [feelings, setFeelings] = useState<Feeling[]>(initialFeelings);
  const [nextSpeaker, setNextSpeaker] = useState(initialNextSpeaker);
  const [injection, setInjection] = useState("");
  const [stepping, setStepping] = useState(false);
  const [error, setError] = useState("");
  const [costUsd, setCostUsd] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 출연진 표정 얼굴 — name+archetype 캐시로 생성/재사용. 감정 변화에 따라 표정 교체.
  const [castFaces, setCastFaces] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {};
    for (const c of cast) if (c.faces) init[c.name] = { ...c.faces };
    return init;
  });
  const [castExpr, setCastExpr] = useState<Record<string, string>>({});
  const faceTried = useRef(false);

  function pickCastFace(c: Cast): string {
    const set = castFaces[c.name];
    const e = castExpr[c.name] || "neutral";
    return (set && (set[e] || set.neutral)) || c.portraitUrl || "";
  }

  // 마운트 시 출연진 얼굴 확보(중립 먼저, 표정은 병렬 스트리밍). 캐시 히트면 즉시.
  useEffect(() => {
    if (faceTried.current) return;
    faceTried.current = true;
    const postChar = async (c: Cast, expr?: string) => {
      const res = await fetch("/api/sim/faces/char", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: c.name, archetype: c.archetype, ...(expr ? { expr } : {}) }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || "얼굴 생성 실패");
      return data.faces as Record<string, string>;
    };
    (async () => {
      for (const c of cast) {
        if (castFaces[c.name]?.neutral) continue;
        try {
          const neu = await postChar(c);
          setCastFaces((f) => ({ ...f, [c.name]: { ...(f[c.name] || {}), ...neu } }));
          const missing = EXPR_IDS.filter((e) => !neu[e]);
          await Promise.all(
            missing.map((e) =>
              postChar(c, e)
                .then((r) => setCastFaces((f) => ({ ...f, [c.name]: { ...(f[c.name] || {}), ...r } })))
                .catch(() => {})
            )
          );
        } catch {
          /* 이 인물 얼굴 실패해도 관전은 계속 */
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 화면 전체 호들갑 버스트(플레이 화면과 동일 방식).
  const [bursts, setBursts] = useState<
    { id: number; type: "like" | "dislike"; left: number; top: number; size: number; dx: number; dy: number; rot: number; delay: number }[]
  >([]);
  const burstId = useRef(0);
  function spawnBursts(type: "like" | "dislike", mag: number) {
    const count = Math.min(44, 4 + mag * 4);
    const size = Math.min(5, 1.4 + mag * 0.5);
    const items = Array.from({ length: count }, () => ({
      id: burstId.current++,
      type,
      left: Math.random() * 96,
      top: Math.random() * 92,
      size,
      dx: Math.round((Math.random() * 2 - 1) * 150),
      dy: Math.round(-60 - Math.random() * 220),
      rot: Math.round((Math.random() * 2 - 1) * 60),
      delay: Math.round(Math.random() * 550),
    }));
    setBursts((b) => [...b, ...items]);
    const ids = new Set(items.map((x) => x.id));
    setTimeout(() => setBursts((b) => b.filter((x) => !ids.has(x.id))), 2600);
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, stepping]);

  async function step(useInjection: boolean) {
    if (stepping) return;
    setStepping(true);
    setError("");
    const inj = useInjection ? injection.trim() : "";
    try {
      const res = await fetch("/api/sim/theater/step", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theaterId, ...(inj ? { injection: inj } : {}) }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `진행 실패 (${res.status})`);
      setTurns((t) => [...t, { speaker: data.speaker, text: data.reply, situation: inj || undefined }]);
      setFeelings(data.feelings ?? feelings);
      setNextSpeaker(data.nextSpeaker ?? "");
      if (useInjection) setInjection("");
      setCostUsd((c) => c + (data.costUsd ?? 0));
      const nextExpr: Record<string, string> = { ...castExpr };
      // 말한 인물(화자)은 방금 말했으니 중립으로.
      if (data.speaker) nextExpr[data.speaker] = "neutral";
      for (const d of (data.deltas ?? []) as Delta[]) {
        if (d.likeDelta > 0) spawnBursts("like", d.likeDelta);
        if (d.dislikeDelta > 0) spawnBursts("dislike", d.dislikeDelta);
        // d.from(청자)이 화자에게 느낀 변화 → 청자 표정 교체.
        if (d.dislikeDelta > 0 && d.dislikeDelta >= d.likeDelta) nextExpr[d.from] = "frown";
        else if (d.likeDelta > 0) nextExpr[d.from] = d.likeDelta >= 3 ? "blush" : "smile";
      }
      setCastExpr(nextExpr);
    } catch (e) {
      setError(e instanceof Error ? e.message : "진행 실패");
    } finally {
      setStepping(false);
    }
  }

  return (
    <div className="mt-4">
      {/* 화면 전체 호들갑 버스트 */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        {bursts.map((b) => (
          <span
            key={b.id}
            className={b.type === "like" ? "sim-burst" : "sim-burst sim-dark"}
            style={
              {
                left: `${b.left}%`,
                top: `${b.top}%`,
                fontSize: `${b.size}rem`,
                animationDelay: `${b.delay}ms`,
                "--dx": `${b.dx}px`,
                "--dy": `${b.dy}px`,
                "--rot": `${b.rot}deg`,
              } as CSSProperties
            }
          >
            {b.type === "like" ? "❤️" : "💔"}
          </span>
        ))}
      </div>

      {/* 출연진 */}
      <div className="flex flex-wrap items-center justify-center gap-4">
        {cast.map((c) => {
          const url = pickCastFace(c);
          const speaking = nextSpeaker === c.name;
          return (
            <div key={c.name} className="flex flex-col items-center">
              {url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={c.name}
                  className={`h-16 w-16 rounded-2xl object-cover object-top ring-2 transition ${
                    speaking ? "ring-accent" : "ring-transparent"
                  }`}
                />
              ) : (
                <span
                  className={`flex h-16 w-16 items-center justify-center rounded-2xl bg-zinc-200 dark:bg-zinc-800 text-lg ring-2 ${
                    speaking ? "ring-accent" : "ring-transparent"
                  }`}
                >
                  {c.name.slice(0, 1)}
                </span>
              )}
              <span className="mt-1 text-xs font-medium">{c.name}</span>
              {c.archetype && <span className="text-[10px] text-zinc-500">{c.archetype}</span>}
            </div>
          );
        })}
      </div>

      {/* 상황 */}
      {situation && (
        <p className="mx-auto mt-3 max-w-[600px] rounded-xl bg-zinc-100 dark:bg-zinc-900 px-3 py-2 text-center text-xs text-zinc-600 dark:text-zinc-400">
          🎬 {situation}
        </p>
      )}

      {/* 대사 로그 */}
      <div
        ref={scrollRef}
        className="mt-3 h-[38vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2 md:h-[46vh]"
      >
        {turns.length === 0 && (
          <p className="text-sm text-zinc-400">‘다음’을 누르면 {nextSpeaker}(이)가 먼저 입을 엽니다.</p>
        )}
        {turns.map((t, i) => (
          <div key={i}>
            {t.situation && (
              <div className="my-1 text-center text-[11px] text-amber-500">⚡ {t.situation}</div>
            )}
            <div className="text-sm">
              <span className="font-semibold text-accent">{t.speaker}</span>
              <span className="ml-1.5">{t.text}</span>
            </div>
          </div>
        ))}
        {stepping && <div className="text-sm text-zinc-400">…</div>}
      </div>

      {/* 인물쌍 감정 (방향별 좋음/싫음) */}
      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {feelings.map((f) => (
          <div key={`${f.from}->${f.to}`} className="flex items-center gap-2 text-[11px]">
            <span className="w-24 shrink-0 truncate text-zinc-500">
              {f.from} <span className="text-zinc-300 dark:text-zinc-600">→</span> {f.to}
            </span>
            <div className="flex flex-1 flex-col gap-0.5">
              <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-pink-400 to-rose-500 transition-all duration-700"
                  style={{ width: `${f.like}%` }}
                />
              </div>
              <div className="h-2.5 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-slate-500 to-slate-800 transition-all duration-700"
                  style={{ width: `${f.dislike}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}

      {/* 난입 + 다음 */}
      <div className="mt-3 flex gap-2">
        <input
          value={injection}
          onChange={(e) => setInjection(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing && injection.trim()) step(true);
          }}
          disabled={stepping}
          placeholder="난입 상황 던지기 (예: 갑자기 정전됐다)"
          className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2.5 text-sm"
        />
        {injection.trim() ? (
          <button
            type="button"
            onClick={() => step(true)}
            disabled={stepping}
            className="shrink-0 rounded-xl border border-amber-300 dark:border-amber-800 px-4 text-sm font-medium text-amber-600 dark:text-amber-400 disabled:opacity-40"
          >
            ⚡ 던지고 다음
          </button>
        ) : (
          <button
            type="button"
            onClick={() => step(false)}
            disabled={stepping}
            className="shrink-0 rounded-xl bg-accent hover:bg-accent-strong text-white text-sm font-semibold px-6 disabled:opacity-40"
          >
            다음 ▶
          </button>
        )}
      </div>

      {isAdmin && (
        <div className="mt-2 text-right text-[11px] text-zinc-400">
          🛠 이번 극장 ₩{Math.round(costUsd * 1400).toLocaleString("ko-KR")}
          <span className="ml-1 text-zinc-300 dark:text-zinc-600">(${costUsd.toFixed(4)})</span>
        </div>
      )}
    </div>
  );
}
