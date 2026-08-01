"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ElongatedTrack } from "@/lib/types";
import {
  bodyChars,
  formatSeconds as fmtSec,
  multiplier,
  won,
  wonRange,
  type ElongatedCostEstimate,
} from "@/lib/elongatedFormat";

interface Preset {
  name: string;
  targetSec: number;
}
interface SourceScene {
  index: number;
  narration: string;
}
// 목표 길이로 정해지는 예상 제작비 — 서버(lib/elongated.ts)가 계산해서 넘긴다.
type CostEstimate = ElongatedCostEstimate;

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
  estimate,
  estimatesByPreset,
  spentKrw,
  chapterBudget,
  sceneCount,
}: {
  project: { id: string; title: string };
  track: ElongatedTrack;
  sourceScenes: SourceScene[];
  sourceExists: boolean;
  presets: Preset[];
  minSec: number;
  maxSec: number;
  estimate: CostEstimate;
  estimatesByPreset: Record<number, CostEstimate>; // targetSec → 예상비(프리셋 칩에 표시)
  spentKrw: string; // 지금까지 쓴 돈(서버 계산 초기값)
  chapterBudget: number; // 챕터 하나의 목표 글자 수(초과 시 빨간 표시)
  sceneCount: number; // 이미 펼쳐 둔 씬 수(0이면 아직 렌더로 안 보냈다)
}) {
  const router = useRouter();

  // 지금까지 이 확장판에 쓴 돈. 첫 값은 서버가 계산해 넘기고(prop), 생성 액션 뒤에만 다시 받는다.
  const [spentLive, setSpentLive] = useState<string>("");
  const spent = spentLive || spentKrw;
  const refreshCost = useCallback(async () => {
    try {
      const r = await fetch(`/api/cost?projectId=${encodeURIComponent(project.id)}`);
      const d = await r.json().catch(() => ({}));
      if (d?.totalKrw) setSpentLive(d.totalKrw as string);
    } catch {
      /* 비용 표시 실패가 작업을 막지 않게 */
    }
  }, [project.id]);
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

  // ── ③ 확장 설계 ──
  const plan = cur.plan;
  const [planBusy, setPlanBusy] = useState(false);
  const [approveBusy, setApproveBusy] = useState(false);
  const [togglingBusy, setTogglingBusy] = useState(false);
  const [planErr, setPlanErr] = useState("");
  const [planWarn, setPlanWarn] = useState<string[]>([]);

  // 아직 사실을 안 찾은 대목(켜 둔 것만) — 사실 찾기가 돌 대상.
  const pending = useMemo(
    () =>
      (plan?.chapters ?? []).flatMap((c) =>
        c.blocks
          .map((b, bi) => ({ chapter: c.index, block: bi, b }))
          .filter((x) => x.b.enabled && !x.b.searchedAt)
      ),
    [plan]
  );
  // 찾아봤는데 근거가 하나도 안 붙은 대목 — "부족한 사실 n건".
  // (카드가 붙었는데 남은 메모가 있는 건 부족이 아니다 — 모델이 세부 미확인을 자주 부기한다)
  const missing = useMemo(
    () =>
      (plan?.chapters ?? []).flatMap((c) =>
        c.blocks.filter((b) => b.enabled && b.searchedAt && b.factIds.length === 0)
      ),
    [plan]
  );
  const expiring = useMemo(() => cur.facts.filter((f) => f.expires), [cur.facts]);

  const [factBusy, setFactBusy] = useState(false);
  const [factProgress, setFactProgress] = useState("");

  // 서버가 대목들을 동시에 돌린다(한 건 89초 실측 — 순차로는 15건에 22분). 300초 상한에
  // 걸려 남은 게 있으면 pending 으로 돌아오므로, 남은 게 없어질 때까지 이어서 부른다.
  async function findFacts(only?: { chapter: number }) {
    setFactBusy(true);
    setPlanErr("");
    try {
      if (only) {
        setFactProgress("사실 찾는 중…");
        const r = await fetch("/api/longform/elongated/plan/facts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: project.id, chapter: only.chapter }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || "사실 찾기 실패");
      } else {
        let left = pending.length;
        for (let pass = 0; pass < 5 && left > 0; pass++) {
          setFactProgress(`사실 찾는 중 · ${left}건 남음`);
          const r = await fetch("/api/longform/elongated/plan/facts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: project.id, all: true }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.ok) throw new Error(d.error || "사실 찾기 실패");
          const next = Array.isArray(d.pending) ? d.pending.length : 0;
          if (next >= left) break; // 더 진척이 없으면 멈춘다(무한 반복 방지)
          left = next;
        }
      }
      router.refresh();
      void refreshCost();
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : "사실 찾기 실패");
      router.refresh();
    } finally {
      setFactBusy(false);
      setFactProgress("");
    }
  }

  async function runPlan() {
    if (plan && !confirm("설계를 다시 만들면 지금 설계와 승인이 사라져요. 진행할까요?")) return;
    setPlanBusy(true);
    setPlanErr("");
    try {
      const r = await fetch("/api/longform/elongated/plan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "확장 설계 실패");
      // 투자 조언 톤이 남았으면 승인 전에 보여준다(다시 설계하거나 그 대목을 끄면 된다).
      setPlanWarn(Array.isArray(d.violations) ? (d.violations as string[]) : []);
      router.refresh();
      void refreshCost();
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : "확장 설계 실패");
    } finally {
      setPlanBusy(false);
    }
  }

  async function patchPlan(body: Record<string, unknown>) {
    const r = await fetch("/api/longform/elongated/plan", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, ...body }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || "저장 실패");
    router.refresh();
  }

  async function toggleBlock(chapter: number, block: number, enabled: boolean) {
    setTogglingBusy(true);
    setPlanErr("");
    try {
      await patchPlan({ toggle: { chapter, block, enabled } });
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setTogglingBusy(false);
    }
  }

  async function approvePlan() {
    setApproveBusy(true);
    setPlanErr("");
    try {
      await patchPlan({ approve: true });
    } catch (e) {
      setPlanErr(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setApproveBusy(false);
    }
  }

  // ── ④ 본문 ──
  const [bodyBusy, setBodyBusy] = useState(false);
  const [bodyProgress, setBodyProgress] = useState("");
  const [bodyErr, setBodyErr] = useState("");
  const written = (plan?.chapters ?? []).filter((c) => (c.body ?? "").trim()).length;
  const totalChars = (plan?.chapters ?? []).reduce((a, c) => a + bodyChars(c.body ?? ""), 0);

  // 챕터는 앞 챕터를 이어받아야 해서 서버가 순서대로 쓴다. 마감에 걸려 남으면 이어서 부른다.
  async function writeBody(chapter?: number) {
    setBodyBusy(true);
    setBodyErr("");
    try {
      if (chapter !== undefined) {
        setBodyProgress("쓰는 중…");
        const r = await fetch("/api/longform/elongated/body", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId: project.id, chapter }),
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok || !d.ok) throw new Error(d.error || "본문 생성 실패");
      } else {
        let left = (plan?.chapters ?? []).filter((c) => !(c.body ?? "").trim()).length;
        for (let pass = 0; pass < 5 && left > 0; pass++) {
          setBodyProgress(`본문 쓰는 중 · ${left}챕터 남음`);
          const r = await fetch("/api/longform/elongated/body", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectId: project.id, all: true }),
          });
          const d = await r.json().catch(() => ({}));
          if (!r.ok || !d.ok) throw new Error(d.error || "본문 생성 실패");
          const next = Array.isArray(d.pending) ? d.pending.length : 0;
          if (next >= left) break; // 더 진척이 없으면 멈춘다
          left = next;
        }
      }
      router.refresh();
      void refreshCost();
    } catch (e) {
      setBodyErr(e instanceof Error ? e.message : "본문 생성 실패");
      router.refresh();
    } finally {
      setBodyBusy(false);
      setBodyProgress("");
    }
  }

  // ── ⑤ 검수 ──
  const [checkBusy, setCheckBusy] = useState<"" | "fact" | "score">("");
  const [checkErr, setCheckErr] = useState("");

  async function runCheck(mode: "fact" | "score") {
    setCheckBusy(mode);
    setCheckErr("");
    try {
      const r = await fetch("/api/longform/elongated/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, mode }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "검수 실패");
      router.refresh();
      if (mode === "score") void refreshCost();
    } catch (e) {
      setCheckErr(e instanceof Error ? e.message : "검수 실패");
    } finally {
      setCheckBusy("");
    }
  }

  // ── ⑥ 렌더로 보내기 ──
  interface ExpiringCard {
    id: string;
    fact: string;
    sourceName: string;
    sourceUrl: string;
    sourceDate: string;
    fetchedAt: string;
  }
  const [sendBusy, setSendBusy] = useState(false);
  const [sendErr, setSendErr] = useState("");
  const [confirmList, setConfirmList] = useState<ExpiringCard[] | null>(null);

  async function sendToRender(confirmed: boolean) {
    setSendBusy(true);
    setSendErr("");
    try {
      const r = await fetch("/api/longform/elongated/scenes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          ...(confirmed ? { confirmedExpiring: true } : {}),
        }),
      });
      const d = await r.json().catch(() => ({}));
      // 재확인이 필요한 사실이 있으면 목록을 먼저 띄운다(동의 없이 넘기지 않는다).
      if (r.status === 409 && d?.needsConfirm) {
        setConfirmList(d.expiring as ExpiringCard[]);
        return;
      }
      if (!r.ok || !d.ok) throw new Error(d.error || "렌더로 보내기 실패");
      router.refresh();
    } catch (e) {
      setSendErr(e instanceof Error ? e.message : "렌더로 보내기 실패");
    } finally {
      setSendBusy(false);
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

      {/* 돈 — 지금까지 쓴 것과 이 길이로 끝까지 갔을 때 */}
      <div className="mt-3 rounded-2xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 px-3 py-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            지금까지 쓴 돈 {spent || "—"}
          </span>
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            완성까지 예상 {wonRange(estimate.totalKrw)}
          </span>
        </div>
        <p className="mt-1 text-[11px] text-amber-700/80 dark:text-amber-400/80">
          씬 {estimate.minScenes}~{estimate.maxScenes}개 · 대본 {won(estimate.scriptKrw)} · 그림{" "}
          {wonRange(estimate.imageKrw)} · 영상 {wonRange(estimate.videoKrw)} · 음성{" "}
          {won(estimate.voiceKrw)}
        </p>
        <p className="mt-0.5 text-[10px] text-amber-700/60 dark:text-amber-400/60">
          영상이 전체의 대부분이에요. 웹검색 도구 사용료는 아직 합계에 안 잡힙니다.
        </p>
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
              {presets.map((p, i) => {
                const est = estimatesByPreset[p.targetSec];
                return (
                  <button key={p.name} type="button" onClick={() => setPresetIdx(i)} className={chip(presetIdx === i)}>
                    {p.name}
                    {est && (
                      <span className="ml-1 opacity-70">약 {won(est.totalKrw[0])}~</span>
                    )}
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

      {/* ── ③ 확장 설계 (동의 게이트) ── */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">③ 확장 설계</h2>
          <button
            type="button"
            onClick={runPlan}
            disabled={planBusy || !sourceExists}
            className="rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5"
          >
            {planBusy ? "설계 중… (몇 분)" : plan ? "다시 설계" : "확장 설계"}
          </button>
        </div>

        {!plan ? (
          <p className="mt-1.5 text-[11px] text-zinc-500">
            원본을 챕터로 나누고, 챕터마다 덧붙일 대목을 배치해요. 그 대목이 필요로 하는 사실은
            웹에서 실제로 찾아 카드로 만듭니다. 본문은 아직 쓰지 않아요.
          </p>
        ) : (
          <div className="mt-2 grid gap-3">
            {/* 열린 고리 */}
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 px-2.5 py-2">
              <p className="text-[11px] font-medium text-zinc-500">열린 고리</p>
              <p className="mt-0.5 text-xs">{plan.openLoop.question || "—"}</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {plan.openLoop.closesAtChapter}번 챕터에서 닫아요
                {plan.openLoop.closingLineHint ? ` · ${plan.openLoop.closingLineHint}` : ""}
              </p>
            </div>

            {/* 챕터 배치 + 덧붙일 대목 */}
            <ol className="grid gap-2">
              {plan.chapters.map((c) => (
                <li key={c.index} className="rounded-xl border border-zinc-100 dark:border-zinc-900 px-2.5 py-2">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <span className="flex-1">
                      {c.index}. {c.title}
                      <span className="ml-1.5 font-normal text-[11px] text-zinc-400">
                        원본 {c.sourceSceneIndexes.map((i) => i + 1).join("·") || "—"}씬
                      </span>
                    </span>
                    {c.blocks.some((b) => b.enabled && b.searchedAt) && (
                      <button
                        type="button"
                        onClick={() => findFacts({ chapter: c.index })}
                        disabled={factBusy}
                        className="shrink-0 rounded border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 text-[10px] font-normal text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
                      >
                        사실 다시 찾기
                      </button>
                    )}
                  </p>
                  {c.role && <p className="mt-0.5 text-[11px] text-zinc-500">{c.role}</p>}
                  {c.blocks.length > 0 && (
                    <ul className="mt-1.5 grid gap-1">
                      {c.blocks.map((b, bi) => {
                        const short = b.searchedAt && !b.factIds.length;
                        return (
                          <li key={bi} className="flex items-start gap-1.5 text-[11px]">
                            <input
                              type="checkbox"
                              checked={b.enabled}
                              onChange={(e) => toggleBlock(c.index, bi, e.target.checked)}
                              disabled={togglingBusy || factBusy}
                              className="mt-0.5 accent-current"
                            />
                            <span className={b.enabled ? "flex-1" : "flex-1 text-zinc-400 line-through"}>
                              <b>{b.type}</b>
                              {b.need ? ` — ${b.need}` : ""}
                              {b.factIds.length > 0 && (
                                <span className="ml-1 text-zinc-400">[{b.factIds.join(", ")}]</span>
                              )}
                              {!b.searchedAt && b.enabled && (
                                <span className="ml-1 text-zinc-400">· 사실 안 찾음</span>
                              )}
                              {short ? (
                                <span className="ml-1 text-amber-600">
                                  ⚠ {b.missing || "근거로 쓸 사실을 못 찾았어요"}
                                </span>
                              ) : (
                                b.missing && (
                                  <span className="ml-1 text-zinc-400" title={b.missing}>
                                    · 일부 미확인
                                  </span>
                                )
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              ))}
            </ol>

            {/* 사실 카드 */}
            <details className="rounded-xl border border-zinc-100 dark:border-zinc-900">
              <summary className="cursor-pointer select-none px-2.5 py-1.5 text-xs font-medium">
                사실 카드 {cur.facts.length}건
                {expiring.length > 0 && (
                  <span className="ml-1.5 text-[11px] font-normal text-amber-600">
                    ⏰ 게시 전 재확인 {expiring.length}건
                  </span>
                )}
              </summary>
              <ul className="border-t border-zinc-100 dark:border-zinc-900 px-2.5 py-2 grid gap-1.5">
                {cur.facts.map((f) => (
                  <li key={f.id} className="text-[11px] leading-relaxed">
                    <span className="text-zinc-400">{f.id}</span>{" "}
                    <span className="rounded bg-zinc-100 dark:bg-zinc-900 px-1">{f.grade}</span>{" "}
                    {f.fact}
                    <span className="text-zinc-400">
                      {" "}
                      — {f.sourceName || "출처"} {f.sourceDate}
                      {f.expires ? " ⏰" : ""}{" "}
                      <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                        링크
                      </a>
                    </span>
                  </li>
                ))}
                {cur.facts.length === 0 && <li className="text-[11px] text-zinc-500">아직 없어요.</li>}
              </ul>
            </details>

            {planWarn.length > 0 && (
              <p className="text-[11px] text-red-600">
                투자 조언 톤이 남았어요 — {planWarn.join(", ")}. 그 대목의 체크를 풀거나 다시
                설계해 주세요.
              </p>
            )}

            {/* 사실 찾기 — 대목 하나씩 웹에서 확인 */}
            {pending.length > 0 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => findFacts()}
                  disabled={factBusy}
                  className="rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5"
                >
                  {factBusy ? factProgress || "찾는 중…" : `🔎 사실 찾기 (${pending.length}건)`}
                </button>
                <span className="text-[11px] text-zinc-500">
                  대목마다 웹에서 확인해요. 한 건에 1분쯤 걸려요.
                </span>
              </div>
            )}

            {/* 부족한 사실 + 승인 */}
            {missing.length > 0 && (
              <p className="text-[11px] text-amber-600">
                부족한 사실 {missing.length}건 — 그대로 두면 본문에 근거 없는 문장이 생겨요. 해당
                대목의 체크를 풀고 진행하거나, 다시 찾아 주세요.
              </p>
            )}
            <div className="flex items-center gap-2">
              {plan.approvedAt ? (
                <span className="text-xs text-accent font-medium">
                  ✅ 설계 승인됨 · {new Date(plan.approvedAt).toLocaleString("ko-KR")}
                </span>
              ) : (
                <button
                  type="button"
                  onClick={approvePlan}
                  disabled={approveBusy || factBusy || pending.length > 0}
                  className="rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5"
                >
                  {approveBusy ? "승인 중…" : "✅ 설계 승인"}
                </button>
              )}
              {!plan.approvedAt && (
                <span className="text-[11px] text-zinc-500">
                  {pending.length > 0
                    ? "사실을 다 찾은 뒤 승인할 수 있어요."
                    : "승인해야 본문을 쓸 수 있어요."}
                </span>
              )}
            </div>
          </div>
        )}
        {planErr && <p className="mt-2 text-xs text-red-600">{planErr}</p>}
      </section>

      {/* ── ④ 본문 ── */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            ④ 본문
            {plan && (
              <span className="ml-1.5 text-[11px] font-normal text-zinc-500">
                {written}/{plan.chapters.length}챕터
                {totalChars > 0 && ` · ${totalChars.toLocaleString("ko-KR")}자`}
              </span>
            )}
          </h2>
          <button
            type="button"
            onClick={() => writeBody()}
            disabled={!plan?.approvedAt || bodyBusy || factBusy}
            className="rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5"
          >
            {bodyBusy ? bodyProgress || "쓰는 중…" : written > 0 ? "남은 챕터 쓰기" : "본문 생성"}
          </button>
        </div>

        {!plan?.approvedAt ? (
          <p className="mt-1.5 text-[11px] text-zinc-500">설계를 승인하면 열려요.</p>
        ) : (
          <div className="mt-2 grid gap-2">
            {plan.chapters.map((c) => {
              const chars = bodyChars(c.body ?? "");
              const over = chars > Math.round(chapterBudget * 1.3);
              return (
                <details key={c.index} className="rounded-xl border border-zinc-100 dark:border-zinc-900">
                  <summary className="cursor-pointer select-none flex items-center gap-2 px-2.5 py-1.5 text-xs">
                    <span className="flex-1 truncate">
                      {c.index}. {c.title}
                    </span>
                    <span className={over ? "text-red-600 font-medium" : "text-zinc-400"}>
                      {chars ? `${chars}자 / ${chapterBudget}자` : "미작성"}
                    </span>
                    {c.body && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          void writeBody(c.index);
                        }}
                        disabled={bodyBusy}
                        className="shrink-0 rounded border border-zinc-200 dark:border-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
                      >
                        다시 쓰기
                      </button>
                    )}
                  </summary>
                  {c.body ? (
                    <p className="border-t border-zinc-100 dark:border-zinc-900 px-2.5 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                      {c.body}
                    </p>
                  ) : (
                    <p className="border-t border-zinc-100 dark:border-zinc-900 px-2.5 py-2 text-[11px] text-zinc-500">
                      아직 안 썼어요.
                    </p>
                  )}
                </details>
              );
            })}
            <p className="text-[10px] text-zinc-400">
              대괄호 안 [F-001] 은 그 문장의 근거 카드예요. 낭독·자막엔 안 들어가고 렌더 전에
              지워집니다.
            </p>
          </div>
        )}
        {bodyErr && <p className="mt-2 text-xs text-red-600">{bodyErr}</p>}
      </section>

      {/* ── ⑤ 검수 ── */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <h2 className="text-sm font-semibold">⑤ 검수</h2>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => runCheck("fact")}
            disabled={!!checkBusy || written === 0}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
          >
            {checkBusy === "fact" ? "대조 중…" : "팩트 대조"}
          </button>
          <button
            type="button"
            onClick={() => runCheck("score")}
            disabled={!!checkBusy || written === 0}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-50 dark:hover:bg-zinc-900 disabled:opacity-40"
          >
            {checkBusy === "score" ? "채점 중…" : "채점표"}
          </button>
          <span className="text-[11px] text-zinc-500">팩트 대조는 기계 대조라 돈이 안 들어요.</span>
        </div>

        {cur.factCheck && (
          <div className="mt-3">
            <p className="text-xs font-medium">
              팩트 대조 —{" "}
              {cur.factCheck.items.length === 0 ? (
                <span className="text-accent">통과</span>
              ) : (
                <span className="text-red-600">{cur.factCheck.items.length}건 불일치</span>
              )}
            </p>
            {cur.factCheck.items.length > 0 && (
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="text-zinc-400">
                    <tr>
                      <th className="text-left font-normal pr-2">챕터</th>
                      <th className="text-left font-normal pr-2">문제</th>
                      <th className="text-left font-normal pr-2">판정</th>
                      <th className="text-left font-normal">문장</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cur.factCheck.items.map((it, i) => (
                      <tr key={i} className="border-t border-zinc-100 dark:border-zinc-900">
                        <td className="pr-2 py-1 align-top">{it.chapter}</td>
                        <td className="pr-2 py-1 align-top font-medium">{it.token}</td>
                        <td className="pr-2 py-1 align-top text-red-600 whitespace-nowrap">
                          {it.verdict}
                          {it.cardId ? ` (${it.cardId})` : ""}
                        </td>
                        <td className="py-1 align-top text-zinc-500 line-clamp-2">{it.sentence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {cur.score && (
          <div className="mt-3">
            <p className="text-xs font-medium">
              채점표 —{" "}
              <span className={cur.score.summary === "통과" ? "text-accent" : "text-red-600"}>
                {cur.score.summary}
              </span>
            </p>
            <ul className="mt-1.5 grid gap-1">
              {cur.score.items.map((it) => (
                <li key={it.no} className="flex items-start gap-1.5 text-[11px]">
                  <span className={it.pass ? "text-accent" : "text-red-600"}>
                    {it.pass ? "○" : "✕"}
                  </span>
                  <span className="flex-1">
                    <span className={it.pass ? "" : "font-medium"}>
                      {it.no}. {it.label}
                    </span>
                    {it.evidence && <span className="ml-1 text-zinc-500">— {it.evidence}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {checkErr && <p className="mt-2 text-xs text-red-600">{checkErr}</p>}
      </section>

      {/* ── ⑥ 렌더로 보내기 ── */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">⑥ 렌더로 보내기</h2>
          <button
            type="button"
            onClick={() => sendToRender(false)}
            disabled={sendBusy || written === 0 || written < (plan?.chapters.length ?? 0)}
            className="rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5"
          >
            {sendBusy ? "보내는 중…" : sceneCount > 0 ? "씬 다시 만들기" : "렌더로 보내기"}
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-zinc-500">
          본문을 4~7초 씬으로 나눠 그림·영상·목소리 화면으로 넘겨요. 근거 표시는 여기서 지워집니다.
        </p>
        {sceneCount > 0 && (
          <p className="mt-2 text-xs">
            씬 {sceneCount}개 준비됨 ·{" "}
            <Link href={`/project/${project.id}?stage=render`} className="text-accent underline">
              그림·영상·합성 화면으로
            </Link>
          </p>
        )}
        {sendErr && <p className="mt-2 text-xs text-red-600">{sendErr}</p>}
      </section>

      {/* 게시 전 재확인 목록 — 가격·시세류 사실은 시간이 지나면 틀려진다 */}
      {confirmList && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white dark:bg-zinc-950 p-4 shadow-xl">
            <h3 className="text-sm font-semibold">⏰ 게시 전 재확인 목록</h3>
            <p className="mt-1 text-[11px] text-zinc-500">
              시간이 지나면 틀려지는 사실이에요. 지금도 맞는지 확인한 뒤 진행해 주세요.
            </p>
            <ul className="mt-3 grid gap-2">
              {confirmList.map((f) => (
                <li key={f.id} className="text-[11px] leading-relaxed">
                  <span className="text-zinc-400">{f.id}</span> {f.fact}
                  <span className="text-zinc-400">
                    {" "}
                    — {f.sourceName} {f.sourceDate} (수집 {f.fetchedAt}){" "}
                    <a href={f.sourceUrl} target="_blank" rel="noreferrer" className="text-accent underline">
                      링크
                    </a>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmList(null)}
                className="rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-xs text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                취소
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmList(null);
                  void sendToRender(true);
                }}
                disabled={sendBusy}
                className="rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5"
              >
                확인했어요 · 진행
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
