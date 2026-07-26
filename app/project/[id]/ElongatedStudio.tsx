"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ElongatedTrack } from "@/lib/types";
import { formatSeconds as fmtSec, multiplier } from "@/lib/elongatedFormat";

interface Preset {
  name: string;
  targetSec: number;
}
interface SourceScene {
  index: number;
  narration: string;
}

// 확장판 스튜디오 — 화면 순서가 곧 작업 순서다.
//   ① 원본(읽기 전용) → ② 목표 길이 → ③ 확장 설계 → ④ 본문 → ⑤ 검수 → ⑥ 렌더로 보내기
export default function ElongatedStudio({
  project,
  track,
  sourceScenes,
  sourceExists,
  presets,
  minSec,
  maxSec,
}: {
  project: { id: string; title: string };
  track: ElongatedTrack;
  sourceScenes: SourceScene[];
  sourceExists: boolean;
  presets: Preset[];
  minSec: number;
  maxSec: number;
}) {
  const router = useRouter();
  // 저장 결과는 router.refresh() 로 서버에서 다시 받아 prop 으로 들어온다 — 사본을 두지 않는다
  // (useState(prop) 사본은 최초 1회만 잡혀 화면이 안 바뀌는 사고의 원인이었다).
  const cur = track;

  const [editLen, setEditLen] = useState(false);
  const [presetIdx, setPresetIdx] = useState<number>(() => {
    const i = presets.findIndex((p) => p.targetSec === track.targetSec);
    return i >= 0 ? i : -1;
  });
  const [customMin, setCustomMin] = useState<string>(() =>
    presets.some((p) => p.targetSec === track.targetSec) ? "" : String(Math.round(track.targetSec / 60))
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const isCustom = presetIdx === -1;
  const pendingSec = useMemo(() => {
    if (!isCustom) return presets[presetIdx]?.targetSec ?? 0;
    const m = parseFloat(customMin);
    return Number.isFinite(m) ? Math.round(m * 60) : 0;
  }, [isCustom, presetIdx, presets, customMin]);
  const pendingOk = pendingSec >= minSec && pendingSec <= maxSec;

  const x = multiplier(cur.sourceSeconds, cur.targetSec);

  async function saveLength() {
    if (!pendingOk) return;
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/longform/elongated", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          targetSec: pendingSec,
          presetName: isCustom ? undefined : presets[presetIdx]?.name,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "저장 실패");
      setEditLen(false);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(false);
    }
  }

  const chip = (active: boolean) =>
    `rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? "border-accent bg-accent text-white"
        : "border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-300 hover:border-accent"
    }`;

  return (
    <main className="px-4 py-6 md:max-w-2xl md:mx-auto">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight line-clamp-2">{project.title}</h1>
          <p className="mt-1 text-[11px] text-zinc-500">
            확장판 · 원본 {fmtSec(cur.sourceSeconds)} → {fmtSec(cur.targetSec)}
            {x ? ` (약 ${x}배)` : ""}
          </p>
        </div>
        <Link
          href="/longform?kind=elongated"
          className="shrink-0 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          ← 롱폼
        </Link>
      </div>

      {/* ── ① 원본 대본 (읽기 전용) ── */}
      <section className="mt-6">
        <details className="rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-semibold">
            ① 원본 대본
            <span className="ml-2 text-[11px] font-normal text-zinc-500">
              {sourceScenes.length}씬 · 읽기 전용
            </span>
          </summary>
          <div className="border-t border-zinc-100 dark:border-zinc-900 px-3 py-2.5">
            <p className="text-[11px] text-zinc-500">
              확정된 원본 대본은 손대지 않아요. 확장판은 이걸 읽기만 합니다.
            </p>
            {!sourceExists ? (
              <p className="mt-2 text-xs text-red-600">
                원본 숏폼을 찾을 수 없어요(삭제된 것 같아요). 설계·본문 생성이 막힙니다.
              </p>
            ) : (
              <ol className="mt-2 grid gap-1.5">
                {sourceScenes.map((s) => (
                  <li key={s.index} className="flex gap-2 text-xs leading-relaxed">
                    <span className="shrink-0 text-zinc-400">{s.index + 1}</span>
                    <span className="text-zinc-700 dark:text-zinc-300">{s.narration}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </details>
      </section>

      {/* ── ② 목표 길이 ── */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">② 목표 길이</h2>
          {!editLen && (
            <button
              type="button"
              onClick={() => setEditLen(true)}
              className="text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 px-2.5 py-1 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            >
              수정
            </button>
          )}
        </div>

        {!editLen ? (
          <p className="mt-1.5 text-sm">
            {fmtSec(cur.targetSec)}
            {cur.presetName ? ` · ${cur.presetName}` : ""}{" "}
            <span className="text-zinc-500">(원본의 약 {x}배)</span>
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {presets.map((p, i) => (
                <button key={p.name} type="button" onClick={() => setPresetIdx(i)} className={chip(presetIdx === i)}>
                  {p.name}
                </button>
              ))}
              <button type="button" onClick={() => setPresetIdx(-1)} className={chip(isCustom)}>
                직접 입력
              </button>
              {isCustom && (
                <span className="flex items-center gap-1">
                  <input
                    type="number"
                    min={Math.round(minSec / 60)}
                    max={Math.round(maxSec / 60)}
                    value={customMin}
                    onChange={(e) => setCustomMin(e.target.value)}
                    className="w-20 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-accent"
                  />
                  <span className="text-xs text-zinc-500">분</span>
                </span>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={saveLength}
                disabled={busy || !pendingOk}
                className="rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5"
              >
                {busy ? "저장 중…" : "저장"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditLen(false);
                  setErr("");
                }}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                취소
              </button>
              {!pendingOk && (
                <span className="text-[11px] text-red-600">
                  {Math.round(minSec / 60)}~{Math.round(maxSec / 60)}분 사이
                </span>
              )}
            </div>
            {cur.plan && (
              <p className="mt-2 text-[11px] text-amber-600">
                이미 설계가 있어요. 목표 길이를 바꾸면 챕터 분량이 어긋나니 설계를 다시 만드는 게
                좋아요.
              </p>
            )}
          </>
        )}
        {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      </section>

      {/* ③ 확장 설계 · ④ 본문 · ⑤ 검수 · ⑥ 렌더로 보내기 — 이어서 붙습니다 */}
      <p className="mt-6 text-center text-[11px] text-zinc-400">
        다음 단계(확장 설계 · 본문 · 검수 · 렌더)는 이어서 붙습니다.
      </p>
    </main>
  );
}
