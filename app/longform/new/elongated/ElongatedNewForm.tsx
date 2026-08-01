"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatSeconds as fmtSec,
  multiplier,
  estimateCost,
  stretchWarning,
  won,
  wonRange,
  type CostRates,
} from "@/lib/elongatedFormat";

interface ShortItem {
  id: string;
  title: string;
  keyframeUrl?: string;
  sceneCount: number;
  speakSec: number;
  createdAt: number;
}
interface Preset {
  name: string;
  targetSec: number;
}

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ① 늘릴 원본 한 편 고르기 → ② 목표 길이 → 확장판 생성.
// 원본 성적(조회수·완주율)은 아직 시스템에 없는 데이터라 표시하지 않는다.
export default function ElongatedNewForm({
  shorts,
  presets,
  minSec,
  maxSec,
  rates,
  maxMultiplier,
}: {
  shorts: ShortItem[];
  presets: Preset[];
  minSec: number;
  maxSec: number;
  rates: CostRates;
  maxMultiplier: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<ShortItem[]>(shorts);
  // 고른 항목을 통째로 들고 있는다 — 검색으로 목록이 갈려도 선택과 배수 표시가 유지된다.
  const [selected, setSelected] = useState<ShortItem | null>(null);
  const sel = selected?.id ?? "";
  const [presetIdx, setPresetIdx] = useState<number>(1); // 5분 표준
  const [customMin, setCustomMin] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchInfo, setSearchInfo] = useState("");

  const isCustom = presetIdx === -1;
  const targetSec = useMemo(() => {
    if (!isCustom) return presets[presetIdx]?.targetSec ?? 0;
    const m = parseFloat(customMin);
    return Number.isFinite(m) ? Math.round(m * 60) : 0;
  }, [isCustom, presetIdx, presets, customMin]);

  const x = selected ? multiplier(selected.speakSec, targetSec) : 0;
  const targetOk = targetSec >= minSec && targetSec <= maxSec;
  // 길이를 고르는 자리에서 바로 돈이 보여야 한다 — 8분은 영상비만 5만 원대다.
  const est = useMemo(() => (targetOk ? estimateCost(targetSec, rates) : null), [targetOk, targetSec, rates]);
  // 너무 늘리면 원본 비중이 작아져 본문 대부분을 새 사실로 채워야 한다 — 경고만 한다.
  const stretch = useMemo(
    () => (selected ? stretchWarning(selected.speakSec, targetSec, maxMultiplier) : null),
    [selected, targetSec, maxMultiplier]
  );

  async function runSearch(nextQ: string) {
    setSearching(true);
    setErr("");
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
      setErr(e instanceof Error ? e.message : "검색 실패");
    } finally {
      setSearching(false);
    }
  }

  async function submit() {
    if (!sel) {
      setErr("늘릴 원본을 한 편 골라주세요");
      return;
    }
    if (!targetOk) {
      setErr(`목표 길이는 ${Math.round(minSec / 60)}~${Math.round(maxSec / 60)}분 사이로 정해주세요`);
      return;
    }
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/longform/elongated", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceId: sel,
          targetSec,
          presetName: isCustom ? undefined : presets[presetIdx]?.name,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "확장판 만들기 실패");
      router.push(`/project/${d.projectId}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "확장판 만들기 실패");
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
    <div className="mt-5">
      {/* ── 1. 늘릴 원본 고르기 ── */}
      <h2 className="text-sm font-semibold">1. 늘릴 원본 고르기</h2>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          runSearch(q);
        }}
        className="mt-2 flex gap-2"
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

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">
          {searchInfo ? "검색 결과가 없어요." : "완성된 숏폼이 없어요. 먼저 숏폼을 완성해 주세요."}
        </p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {items.map((s) => {
            const on = s.id === sel;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setSelected(on ? null : s)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-2.5 py-2 text-left transition-colors ${
                    on
                      ? "border-accent ring-2 ring-accent bg-accent/5"
                      : "border-zinc-200 dark:border-zinc-800 hover:border-accent"
                  }`}
                >
                  <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-zinc-100 dark:bg-zinc-900">
                    {s.keyframeUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.keyframeUrl} alt="" className="h-full w-full object-cover" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{s.title}</span>
                    <span className="block text-[11px] text-zinc-500">
                      {fmtDate(s.createdAt)} · {s.sceneCount}씬 · 약 {fmtSec(s.speakSec)}
                    </span>
                  </span>
                  {on && <span className="shrink-0 text-accent text-lg">✓</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── 2. 목표 길이 ── */}
      <h2 className="mt-7 text-sm font-semibold">2. 목표 길이</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {presets.map((p, i) => {
          const e = estimateCost(p.targetSec, rates);
          // 고른 원본 기준 배수를 칩에 같이 띄운다 — 고르기 전에 무리한 배수인지 보여야 한다.
          const w = selected ? stretchWarning(selected.speakSec, p.targetSec, maxMultiplier) : null;
          return (
            <button key={p.name} type="button" onClick={() => setPresetIdx(i)} className={chip(presetIdx === i)}>
              {p.name}
              {w && (
                <span className={w.over ? "ml-1 text-amber-600" : "ml-1 opacity-70"}>
                  {w.over ? "⚠ " : ""}
                  {w.times}배
                </span>
              )}
              <span className="ml-1 opacity-70">약 {won(e.totalKrw[0])}~</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setPresetIdx(-1)} className={chip(isCustom)}>
          직접 입력
        </button>
        {isCustom && (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={Math.round(minSec / 60)}
              max={Math.round(maxSec / 60)}
              step={1}
              value={customMin}
              onChange={(e) => setCustomMin(e.target.value)}
              placeholder="5"
              className="w-20 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-sm outline-none focus:border-accent"
            />
            <span className="text-xs text-zinc-500">분</span>
          </span>
        )}
      </div>

      <p className="mt-3 text-sm">
        {!selected ? (
          <span className="text-zinc-400">원본을 고르면 배수가 나와요.</span>
        ) : !targetOk ? (
          <span className="text-red-600">
            목표 길이는 {Math.round(minSec / 60)}~{Math.round(maxSec / 60)}분 사이로 정해주세요.
          </span>
        ) : (
          <span className="text-zinc-700 dark:text-zinc-200">
            원본 {fmtSec(selected.speakSec)} → 목표 {fmtSec(targetSec)}{" "}
            <b className="text-accent">(약 {x}배)</b>
          </span>
        )}
      </p>

      {stretch?.over && (
        <div className="mt-3 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            ⚠ 원본의 {stretch.times}배 — 좀 많이 늘리는 거예요
          </p>
          <p className="mt-1 text-[11px] text-amber-700/90 dark:text-amber-400/90">
            원본 내용이 완성본의 {stretch.sourceShare}%밖에 안 돼요. 나머지는 새로 찾은 사실로
            채워야 하는데, 채울 게 모자라면 대본에 근거 없는 숫자가 섞입니다. {maxMultiplier}배
            안쪽을 권해요.
          </p>
        </div>
      )}

      {est && (
        <div className="mt-3 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            완성까지 예상 비용 {wonRange(est.totalKrw)}
          </p>
          <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
            씬 {est.minScenes}~{est.maxScenes}개 · 대본 {won(est.scriptKrw)} · 그림{" "}
            {wonRange(est.imageKrw)} · 영상 {wonRange(est.videoKrw)} · 음성 {won(est.voiceKrw)}
          </p>
          <p className="mt-0.5 text-[10px] text-amber-700/60 dark:text-amber-400/60">
            영상이 전체의 대부분이에요. 웹검색 도구 사용료는 아직 합계에 안 잡힙니다.
          </p>
        </div>
      )}

      {err && <p className="mt-3 text-xs text-red-600">{err}</p>}

      <button
        onClick={submit}
        disabled={busy || !sel || !targetOk}
        className="mt-4 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium px-4 py-2.5"
      >
        {busy ? "만드는 중…" : "확장판 만들기"}
      </button>
    </div>
  );
}
