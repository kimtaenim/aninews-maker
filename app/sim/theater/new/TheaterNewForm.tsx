"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Spinner from "@/components/Spinner";

export interface PoolMember {
  name: string;
  archetype?: string;
  portraitUrl?: string;
}

const ARCHETYPES = [
  "마초남", "츤데레남", "재벌남", "나쁜남자", "순정남", "능글남",
  "청순녀", "4차원녀", "새침녀", "카리스마녀", "발랄녀", "저돌적인 여자",
];

// 상황 예시(칩으로 빠르게).
const SITUATION_PRESETS = [
  "비 오는 날 한 우산 아래 갇힌 두 사람",
  "전 애인과 새 연인이 같은 자리에서 마주쳤다",
  "라이벌 회사 후계자들이 협상 테이블에 앉았다",
  "밤샘 프로젝트, 둘만 남은 사무실",
];

export default function TheaterNewForm({ pool }: { pool: PoolMember[] }) {
  const router = useRouter();
  const [cast, setCast] = useState<PoolMember[]>([]);
  const [situation, setSituation] = useState("");
  const [dName, setDName] = useState("");
  const [dArche, setDArche] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  const has = (name: string) => cast.some((c) => c.name === name);

  function togglePool(m: PoolMember) {
    setError("");
    if (has(m.name)) {
      setCast((c) => c.filter((x) => x.name !== m.name));
    } else if (cast.length >= 3) {
      setError("출연진은 최대 3명이에요");
    } else {
      setCast((c) => [...c, m]);
    }
  }

  function addDirect() {
    const name = dName.trim();
    if (!name) return;
    if (has(name)) return setError("이미 있는 이름이에요");
    if (cast.length >= 3) return setError("출연진은 최대 3명이에요");
    setCast((c) => [...c, { name, archetype: dArche.trim() || undefined }]);
    setDName("");
    setDArche("");
    setError("");
  }

  async function start() {
    if (busy) return;
    if (cast.length < 2) return setError("출연진을 2~3명 골라주세요");
    setBusy(true);
    setError("");
    try {
      // 각 인물 페르소나 생성(병렬).
      setNote("인물 성격 만드는 중…");
      const withPersona = await Promise.all(
        cast.map(async (c) => {
          const res = await fetch("/api/sim/persona", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: c.name, archetype: c.archetype }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || `${c.name} 성격 생성 실패`);
          return {
            name: c.name,
            archetype: c.archetype,
            persona: data.persona as string,
            portraitUrl: c.portraitUrl,
          };
        })
      );
      setNote("무대 여는 중…");
      const res = await fetch("/api/sim/theater", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ situation: situation.trim(), cast: withPersona }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error || `생성 실패 (${res.status})`);
      router.push(`/sim/theater/${data.theaterId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "극장 생성 실패");
      setBusy(false);
      setNote("");
    }
  }

  return (
    <div className="mt-5 grid gap-5">
      {/* 상황 */}
      <div>
        <h2 className="text-sm font-semibold">상황 (무대 설정)</h2>
        <textarea
          value={situation}
          onChange={(e) => setSituation(e.target.value)}
          rows={2}
          placeholder="예: 비 오는 날 한 우산 아래 갇힌 두 사람"
          className="mt-2 w-full rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent p-3 text-sm"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SITUATION_PRESETS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSituation(s)}
              className="rounded-full border border-zinc-200 dark:border-zinc-800 px-2.5 py-0.5 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* 출연진 */}
      <div>
        <h2 className="text-sm font-semibold">
          출연진 <span className="text-zinc-400">(2~3명 · {cast.length}명 선택됨)</span>
        </h2>

        {pool.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            {pool.map((m) => (
              <button
                key={m.name}
                type="button"
                onClick={() => togglePool(m)}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm ${
                  has(m.name)
                    ? "border-accent bg-accent/10"
                    : "border-zinc-200 dark:border-zinc-800"
                }`}
              >
                {m.portraitUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.portraitUrl} alt={m.name} className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-zinc-200 dark:bg-zinc-800 text-xs">
                    {m.name.slice(0, 1)}
                  </span>
                )}
                {m.name}
                {m.archetype && <span className="text-xs text-zinc-500">{m.archetype}</span>}
              </button>
            ))}
          </div>
        )}

        {/* 직접 추가 */}
        <div className="mt-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-3">
          <div className="text-xs font-medium text-zinc-500">직접 추가</div>
          <div className="mt-2 flex gap-2">
            <input
              value={dName}
              onChange={(e) => setDName(e.target.value)}
              placeholder="이름"
              className="w-28 shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
            />
            <input
              value={dArche}
              onChange={(e) => setDArche(e.target.value)}
              placeholder="성격 (예: 츤데레남)"
              className="flex-1 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-transparent px-3 py-2 text-sm"
            />
            <button
              type="button"
              onClick={addDirect}
              className="shrink-0 rounded-xl border border-zinc-200 dark:border-zinc-800 px-3 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-900"
            >
              추가
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ARCHETYPES.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setDArche(a)}
                className={`rounded-full border px-2.5 py-0.5 text-xs ${
                  dArche === a
                    ? "border-accent bg-accent/10"
                    : "border-zinc-200 dark:border-zinc-800 text-zinc-500"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </div>

        {/* 선택된 출연진 */}
        {cast.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {cast.map((c) => (
              <span
                key={c.name}
                className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-3 py-1 text-sm"
              >
                {c.name}
                {c.archetype && <span className="text-xs text-zinc-500">{c.archetype}</span>}
                <button
                  type="button"
                  onClick={() => setCast((x) => x.filter((y) => y.name !== c.name))}
                  className="text-zinc-400 hover:text-red-500"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <button
        type="button"
        disabled={busy || cast.length < 2}
        onClick={start}
        className="rounded-2xl bg-accent hover:bg-accent-strong text-white font-semibold px-5 py-3 disabled:opacity-40"
      >
        {busy ? (
          <span className="inline-flex items-center justify-center gap-1.5">
            <Spinner /> {note || "여는 중"}
          </span>
        ) : (
          "🎭 극장 시작"
        )}
      </button>
    </div>
  );
}
