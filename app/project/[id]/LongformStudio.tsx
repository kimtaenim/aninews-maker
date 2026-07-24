"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type {
  LongformScriptPackage,
  LongformSection,
  LongformThumbnailPackage,
  LongformTitlePackage,
  LongformTitleReview,
} from "@/lib/types";
import type { LongformReviewResult } from "@/lib/longformReview";
import { speakSeconds } from "@/lib/longformScreening";

// 브리지 낭독 길이(초) — 타임라인에 진행자 구간 길이를 그대로 보여주기 위해.
function bridgeSeconds(b: { emphasis: string; elevation: string; opening: string }): number {
  return speakSeconds(b.emphasis, b.elevation, b.opening);
}

interface SegInfo {
  id: string;
  title: string;
  keyframeUrl?: string;
  finalVideoUrl?: string;
}

interface HostProject {
  id: string;
  title: string;
  keyframeUrl?: string;
  sceneCount: number;
  finalVideoUrl?: string;
}

// 롱폼 전용 화면 — 제작 파이프라인(모듈 1 제목 → 2~4 대본 → 5 썸네일)과 세그먼트 완성
// 현황을 보여주고, 전부 완성되면 섹션별 부분 합성 → 최종 이어붙이기를 돌린다.
// 세그먼트 재생성은 각 세그먼트 프로젝트(스튜디오)에서 하고, 여기선 상태만 모아 본다.
export default function LongformStudio({
  project,
  segments,
  hostProject,
  initialTitle,
  initialScript,
  initialThumbnail,
}: {
  project: {
    id: string;
    title: string;
    finalVideoUrl?: string;
    eyecatchUrl?: string;
    sections?: LongformSection[] | null;
  };
  segments: SegInfo[];
  hostProject: HostProject | null;
  initialTitle: LongformTitlePackage | null;
  initialScript: LongformScriptPackage | null;
  initialThumbnail: LongformThumbnailPackage | null;
}) {
  const router = useRouter();

  // ── 누적 비용 — 롱폼 자신(제목·대본·썸네일) + 세그먼트 전부 + 진행자 합산.
  // 무거운 이미지·영상·음성 비용은 세그먼트 쪽에 기록되므로 합산해야 실제 제작비가 나온다.
  const [cost, setCost] = useState<{
    totalKrw: string;
    own?: string;
    segments?: string;
    segCount?: number;
    host?: string;
  } | null>(null);
  const refreshCost = useCallback(async () => {
    try {
      const r = await fetch(`/api/cost?projectId=${encodeURIComponent(project.id)}&includeSegments=1`);
      const d = await r.json();
      if (typeof d.totalKrw === "string") {
        setCost({
          totalKrw: d.totalKrw,
          own: d.breakdown?.own?.krw,
          segments: d.breakdown?.segments?.krw,
          segCount: d.breakdown?.segments?.count,
          host: d.breakdown?.host?.krw,
        });
      }
    } catch {
      /* 비용 조회 실패는 무시 */
    }
  }, [project.id]);
  useEffect(() => {
    refreshCost();
  }, [refreshCost]);

  // ── [모듈 1] 롱폼 제목 — 검색 5원칙. 확정(title_promise)해야 모듈 2~5가 돈다.
  const [lfTitle, setLfTitle] = useState(project.title);
  const [titlePkg, setTitlePkg] = useState<LongformTitlePackage | null>(initialTitle);
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleErr, setTitleErr] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const confirmedTitle = titlePkg?.finalTitle ?? "";

  async function genLongTitle() {
    setTitleBusy(true);
    setTitleErr("");
    try {
      const r = await fetch("/api/longform/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "제목 생성 실패");
      setTitlePkg(d.title as LongformTitlePackage);
      refreshCost();
    } catch (e) {
      setTitleErr(e instanceof Error ? e.message : "제목 생성 실패");
    } finally {
      setTitleBusy(false);
    }
  }

  // 제목 확정 — 여기서 title_promise 가 고정되고 모듈 2~5의 기준점이 된다.
  async function confirmLongTitle(t: string, thumbnailText: string, titlePromise?: string) {
    const v = t.trim();
    if (!v) return;
    setTitleErr("");
    try {
      const r = await fetch("/api/longform/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          confirm: { title: v, thumbnailText, ...(titlePromise ? { titlePromise } : {}) },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "확정 실패");
      setTitlePkg(d.title as LongformTitlePackage);
      setLfTitle(v);
      refreshCost();
    } catch (e) {
      setTitleErr(e instanceof Error ? e.message : "확정 실패");
    }
  }

  // 직접 쓴 제목 검증 — 원칙으로 진단만 받는다(확정은 따로).
  const [ownTitle, setOwnTitle] = useState("");
  const [review, setReview] = useState<LongformTitleReview | null>(initialTitle?.review ?? null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewErr, setReviewErr] = useState("");

  async function reviewOwnTitle() {
    const v = ownTitle.trim();
    if (!v) return;
    setReviewBusy(true);
    setReviewErr("");
    try {
      const r = await fetch("/api/longform/title", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, review: v }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "검증 실패");
      setReview(d.review as LongformTitleReview);
      if (d.title) setTitlePkg(d.title as LongformTitlePackage);
      refreshCost();
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "검증 실패");
    } finally {
      setReviewBusy(false);
    }
  }
  async function copyLongTitle(t: string, i: number) {
    try {
      await navigator.clipboard.writeText(t);
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx((c) => (c === i ? null : c)), 1500);
    } catch {
      /* 무시 */
    }
  }

  // 롱폼 전체 구조 검수(열린 고리) — 진단 + 동의 모달 + 채택 반영.
  const [rvBusy, setRvBusy] = useState(false);
  const [rvErr, setRvErr] = useState("");
  const [rvPassed, setRvPassed] = useState(false);
  const [rvData, setRvData] = useState<LongformReviewResult | null>(null);
  const [rvStage, setRvStage] = useState<null | "consent" | "revise">(null);
  const [rvPick, setRvPick] = useState({ opening: true, order: true, connectors: true, closing: true });

  async function genReview() {
    setRvBusy(true);
    setRvErr("");
    setRvPassed(false);
    try {
      const r = await fetch("/api/longform/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok || !d.review) throw new Error(d.error || "구조 검수 실패");
      const rev = d.review as LongformReviewResult;
      if (rev.pass) {
        setRvPassed(true);
      } else {
        setRvData(rev);
        setRvPick({ opening: true, order: true, connectors: true, closing: true });
        setRvStage("consent");
      }
    } catch (e) {
      setRvErr(e instanceof Error ? e.message : "구조 검수 실패");
    } finally {
      setRvBusy(false);
    }
  }

  async function applyReview() {
    if (!rvData) return;
    const apply: {
      opening?: string[];
      order?: number[];
      connectors?: { after: number; revised: string }[];
      closing?: string[];
    } = {};
    if (rvPick.opening && rvData.revisedOpening) apply.opening = rvData.revisedOpening;
    if (rvPick.order && rvData.suggestedOrder) apply.order = rvData.suggestedOrder;
    if (rvPick.connectors && rvData.revisedConnectors.length) apply.connectors = rvData.revisedConnectors;
    if (rvPick.closing && rvData.revisedClosing) apply.closing = rvData.revisedClosing;
    try {
      await fetch("/api/longform/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, apply }),
      });
    } catch {
      /* 무시 */
    }
    setRvStage(null);
    setRvData(null);
    router.refresh();
  }
  const [hostBusy, setHostBusy] = useState(false);
  const [hostErr, setHostErr] = useState("");

  // ── [모듈 2~4] 대본 트랙 — 오프닝(2블록) · 세그먼트 순서 + 브리지 · 엔딩(3파트).
  const [script, setScript] = useState<LongformScriptPackage | null>(initialScript);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptSaveBusy, setScriptSaveBusy] = useState(false);
  const [scriptErr, setScriptErr] = useState("");
  const [scriptViolations, setScriptViolations] = useState<string[]>([]);
  const [fixedOrder, setFixedOrder] = useState(false);
  const [edit, setEdit] = useState<{ a: string; b: string; pa: string; pb: string; bridges: string[] } | null>(
    initialScript
      ? {
          a: initialScript.opening.blockAHook,
          b: initialScript.opening.blockBRoadmapLanding,
          pa: initialScript.ending.partAClose,
          pb: initialScript.ending.partBLanding,
          bridges: initialScript.bridges.map((x) => [x.emphasis, x.elevation, x.opening].join("\n")),
        }
      : null
  );

  function loadEdit(p: LongformScriptPackage) {
    setEdit({
      a: p.opening.blockAHook,
      b: p.opening.blockBRoadmapLanding,
      pa: p.ending.partAClose,
      pb: p.ending.partBLanding,
      bridges: p.bridges.map((x) => [x.emphasis, x.elevation, x.opening].join("\n")),
    });
  }

  async function genScript() {
    setScriptBusy(true);
    setScriptErr("");
    setScriptViolations([]);
    try {
      const r = await fetch("/api/longform/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, fixedOrder }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "대본 생성 실패");
      const pkg = d.script as LongformScriptPackage;
      setScript(pkg);
      loadEdit(pkg);
      setScriptViolations(Array.isArray(d.violations) ? d.violations : []);
      refreshCost();
      if (d.orderApplied) router.refresh(); // 순서가 바뀌었으면 세그먼트 목록 다시 읽기
    } catch (e) {
      setScriptErr(e instanceof Error ? e.message : "대본 생성 실패");
    } finally {
      setScriptBusy(false);
    }
  }

  // 수정 저장 — 지적된 블록만 잘게 고친다(전체 되뒤집기 없음).
  async function saveScript() {
    if (!script || !edit) return;
    setScriptSaveBusy(true);
    setScriptErr("");
    try {
      const bridges = script.bridges.map((b, i) => {
        const [emphasis = "", elevation = "", ...rest] = (edit.bridges[i] ?? "").split("\n");
        return {
          afterSegment: b.afterSegment,
          emphasis: emphasis.trim(),
          elevation: elevation.trim(),
          opening: rest.join(" ").trim(),
        };
      });
      const r = await fetch("/api/longform/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          edit: {
            blockAHook: edit.a,
            blockBRoadmapLanding: edit.b,
            partAClose: edit.pa,
            partBLanding: edit.pb,
            bridges,
          },
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "저장 실패");
      setScript(d.script as LongformScriptPackage);
      setScriptViolations(Array.isArray(d.violations) ? d.violations : []);
    } catch (e) {
      setScriptErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setScriptSaveBusy(false);
    }
  }

  // ── [모듈 5] 썸네일 — 시안 3종 + 168px 축소 검증본.
  const [thumb, setThumb] = useState<LongformThumbnailPackage | null>(initialThumbnail);
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbErr, setThumbErr] = useState("");

  async function genThumbnail() {
    setThumbBusy(true);
    setThumbErr("");
    try {
      const r = await fetch("/api/longform/thumbnail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "썸네일 생성 실패");
      setThumb(d.thumbnail as LongformThumbnailPackage);
      refreshCost();
    } catch (e) {
      setThumbErr(e instanceof Error ? e.message : "썸네일 생성 실패");
    } finally {
      setThumbBusy(false);
    }
  }

  async function selectThumbnail(fileUrl: string) {
    try {
      const r = await fetch("/api/longform/thumbnail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, selected: fileUrl }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d.ok) setThumb(d.thumbnail as LongformThumbnailPackage);
    } catch {
      /* 무시 */
    }
  }

  async function genHostScript() {
    setHostBusy(true);
    setHostErr("");
    try {
      const r = await fetch("/api/longform/host-script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "진행자 대본 생성 실패");
      router.refresh(); // 서버에서 새 호스트 씬을 다시 읽어와 표시
    } catch (e) {
      setHostErr(e instanceof Error ? e.message : "진행자 대본 생성 실패");
    } finally {
      setHostBusy(false);
    }
  }
  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [finalUrl, setFinalUrl] = useState<string | undefined>(project.finalVideoUrl);
  const [error, setError] = useState<string>("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [segs, setSegs] = useState(segments); // 순서 변경용 로컬 상태
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // [롱폼] 섹션(2~3세그 부분 합성 단위) 로컬 상태 — 폴링으로 갱신.
  const [secList, setSecList] = useState<LongformSection[]>(project.sections ?? []);

  const readyCount = segs.filter((s) => s.finalVideoUrl).length;
  const allReady = segs.length > 0 && readyCount === segs.length;
  const hasSections = secList.length > 0;
  const secReadyCount = secList.filter((s) => s.videoUrl).length;
  const allSecReady = hasSections && secReadyCount === secList.length;

  // 세그먼트 순서 위/아래로 — 로컬 즉시 반영 + 서버 저장.
  async function moveSeg(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= segs.length || reordering) return;
    const next = [...segs];
    [next[i], next[j]] = [next[j], next[i]];
    setSegs(next);
    setReordering(true);
    try {
      await fetch("/api/longform/reorder", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, order: next.map((s) => s.id) }),
      });
    } catch {
      /* 저장 실패해도 로컬 순서는 유지(다음 이동에서 재시도) */
    } finally {
      setReordering(false);
    }
  }

  // 롱폼 통째 삭제(세그먼트·진행자 포함).
  async function delLongform() {
    if (deleting) return;
    if (!confirm(`"${project.title}" 롱폼을 삭제할까요?\n세그먼트·진행자까지 전부 지워지고 되돌릴 수 없어요.`)) return;
    setDeleting(true);
    try {
      const r = await fetch("/api/longform/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "삭제 실패");
      router.push("/longform");
    } catch (e) {
      alert(e instanceof Error ? e.message : "삭제 실패");
      setDeleting(false);
    }
  }

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  function startPolling() {
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(poll, 3000);
  }

  async function poll() {
    try {
      const r = await fetch(`/api/compose?projectId=${encodeURIComponent(project.id)}`);
      const d = await r.json().catch(() => ({}));
      if (!d.ok) return;
      setStatus(d.status ?? "");
      setProgress(d.progress ?? "");
      if (Array.isArray(d.sections)) setSecList(d.sections as LongformSection[]);
      const anySecGen =
        Array.isArray(d.sections) &&
        (d.sections as LongformSection[]).some((s) => s.status === "generating");
      const joinActive = d.status === "generating";
      if (d.status === "generated" && d.finalVideoUrl) {
        setFinalUrl(d.finalVideoUrl);
        setComposing(false);
      } else if (d.status === "error") {
        setError(d.error || "합성 실패");
        setComposing(false);
      }
      // 섹션 부분 합성·최종 join 모두 끝났으면 폴링 종료(끝났을 때 비용도 한 번 갱신).
      if (!anySecGen && !joinActive && timer.current) {
        clearInterval(timer.current);
        refreshCost();
      }
    } catch {
      /* 일시 오류는 다음 폴링에서 회복 */
    }
  }

  // 레거시(섹션 없는 구버전 롱폼) — 단일 교차 합성.
  async function startCompose() {
    if (!allReady || composing) return;
    setError("");
    setComposing(true);
    setStatus("generating");
    setProgress("합성 요청 중…");
    try {
      const r = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, lang: "ko" }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "합성 요청 실패");
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "합성 요청 실패");
      setComposing(false);
    }
  }

  // [롱폼] 섹션 하나만 부분 합성 — 그 섹션 세그먼트가 전부 완성돼 있어야 한다.
  async function composeSection(sectionId: string) {
    if (composing) return; // 최종 join 중이면 대기
    setError("");
    setSecList((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, status: "generating", error: undefined } : s))
    );
    try {
      const r = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, lang: "ko", sectionId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "섹션 합성 요청 실패");
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "섹션 합성 요청 실패");
      setSecList((prev) => prev.map((s) => (s.id === sectionId ? { ...s, status: "error" } : s)));
    }
  }

  // [롱폼] 섹션 영상들을 최종 이어붙이기 — 모든 섹션이 합성돼 있어야 한다.
  async function startJoin() {
    if (composing || !allSecReady) return;
    setError("");
    setComposing(true);
    setStatus("generating");
    setProgress("최종 이어붙이기 요청 중…");
    try {
      const r = await fetch("/api/compose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, lang: "ko", joinSections: true }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "최종 합성 요청 실패");
      startPolling();
    } catch (e) {
      setError(e instanceof Error ? e.message : "최종 합성 요청 실패");
      setComposing(false);
    }
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight line-clamp-1">🎞 {lfTitle}</h1>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={delLongform}
            disabled={deleting}
            className="text-xs font-medium rounded-lg border border-red-300 dark:border-red-800 px-3 py-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"
          >
            {deleting ? "삭제 중…" : "🗑 삭제"}
          </button>
          <Link
            href="/longform"
            className="text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            ← 롱폼
          </Link>
        </div>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        가로 16:9 롱폼 — 아래 세그먼트를 각각 완성한 뒤 <b>롱폼 합성</b>을 누르면 세그먼트 완성본을
        순서대로 이어붙이고 사이·마지막에 진행자가 이어주고 구독을 유도합니다.
      </p>

      {/* [모듈 1] 롱폼 제목 — 검색 5원칙 */}
      <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">① 제목 (검색 5원칙)</h2>
          <button
            onClick={genLongTitle}
            disabled={titleBusy}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {titleBusy ? "생성 중…" : titlePkg ? "다시 생성" : "제목 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          검색어 후보 → 주 검색어 + 묶음 가치 + 괴리 꼬리로 후보 5개. <b>제목을 확정해야</b> 다음 모듈(대본·썸네일)이
          돌아갑니다 — 제목이 바뀌면 이후가 전부 바뀌니까요.
        </p>
        {titleErr && <p className="mt-2 text-[11px] text-red-600">{titleErr}</p>}
        {titlePkg && (
          <>
            <div className="mt-2 rounded-lg border border-accent/30 bg-white/50 dark:bg-zinc-950/50 p-2 text-[11px]">
              <p>
                <span className="font-semibold text-accent">주 검색어:</span> {titlePkg.primaryKeyword}
                {titlePkg.secondaryKeyword ? ` · 보조: ${titlePkg.secondaryKeyword}` : ""}
              </p>
              {titlePkg.keywordRationale && <p className="mt-0.5 text-zinc-500">↳ {titlePkg.keywordRationale}</p>}
              {titlePkg.keywordCandidates.length > 0 && (
                <p className="mt-0.5 text-zinc-500">후보: {titlePkg.keywordCandidates.join(" · ")}</p>
              )}
            </div>
            <ul className="mt-2 grid gap-2">
              {titlePkg.candidates.map((c, i) => {
                const isConfirmed = confirmedTitle === c.title;
                return (
                  <li
                    key={i}
                    className={`rounded-lg border p-2 ${isConfirmed ? "border-accent bg-accent/10" : "border-zinc-200 dark:border-zinc-800"}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {i === titlePkg.recommendedIndex && (
                            <span className="shrink-0 rounded bg-accent px-1 py-0.5 text-[9px] font-bold text-white">
                              추천
                            </span>
                          )}
                          <span className="text-sm font-medium">{c.title}</span>
                        </div>
                        <div className="mt-0.5 text-[10px] text-zinc-500">
                          썸네일 문구: <b>{c.thumbnailText}</b>
                          {c.violations && c.violations.length > 0 && (
                            <span className="text-red-500"> · ⚠ {c.violations.join(", ")}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => copyLongTitle(c.title, i)}
                          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                          {copiedIdx === i ? "✓ 복사됨" : "📋 복사"}
                        </button>
                        <button
                          type="button"
                          onClick={() => confirmLongTitle(c.title, c.thumbnailText)}
                          className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                            isConfirmed ? "bg-accent/20 text-accent" : "bg-accent text-white hover:bg-accent-strong"
                          }`}
                        >
                          {isConfirmed ? "✓ 확정됨" : "확정"}
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            {titlePkg.recommendation && (
              <p className="mt-1 text-[10px] text-zinc-500">
                <span className="font-semibold">추천:</span> {titlePkg.recommendation}
              </p>
            )}
            {titlePkg.titlePromise && (
              <p className="mt-1 text-[11px]">
                <span className="font-semibold text-accent">title_promise:</span> {titlePkg.titlePromise}
              </p>
            )}
            {titlePkg.rejected.length > 0 && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[10px] text-zinc-500">탈락 후보 {titlePkg.rejected.length}개</summary>
                <ul className="mt-1 grid gap-0.5 text-[10px] text-zinc-500">
                  {titlePkg.rejected.map((r, i) => (
                    <li key={i}>
                      「{r.title}」 — {r.reason}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}

        {/* 직접 쓴 제목 검증 — 생성 없이도 쓸 수 있다. */}
        <div className="mt-3 border-t border-accent/20 pt-3">
          <p className="text-xs font-semibold">직접 쓴 제목 검증</p>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            내가 쓴 제목을 원칙으로 진단받습니다. 원문은 안 바뀌고, 통과하면 그대로 확정할 수 있어요.
          </p>
          <div className="mt-1.5 flex gap-2">
            <input
              type="text"
              value={ownTitle}
              onChange={(e) => setOwnTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") reviewOwnTitle();
              }}
              placeholder="예: 메모리 반도체 관련주, 헬륨 한 방울에 값이 흔들린 이유"
              className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-accent"
            />
            <button
              onClick={reviewOwnTitle}
              disabled={reviewBusy || !ownTitle.trim()}
              className="shrink-0 rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {reviewBusy ? "검증 중…" : "검증"}
            </button>
          </div>
          {reviewErr && <p className="mt-1.5 text-[11px] text-red-600">{reviewErr}</p>}

          {review && (
            <div className="mt-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2 text-[11px]">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 font-medium">「{review.title}」</p>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                    review.verdict === "pass"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {review.verdict === "pass" ? "통과" : "보완 필요"}
                </span>
              </div>
              {review.summary && <p className="mt-1 text-zinc-600 dark:text-zinc-300">{review.summary}</p>}

              {review.violations.length > 0 && (
                <ul className="mt-1.5 grid list-disc gap-0.5 pl-4 text-red-600">
                  {review.violations.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              )}
              {review.issues.length > 0 && (
                <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-amber-600">
                  {review.issues.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              )}
              {review.strengths.length > 0 && (
                <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-emerald-600 dark:text-emerald-400">
                  {review.strengths.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              )}

              <ul className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-zinc-500">
                {Object.entries({ ...review.principlesCheck, ...review.screening }).map(([k, v]) => (
                  <li key={k} className={v ? "" : "text-red-500"}>
                    {v ? "✓" : "✗"} {k.replace(/_/g, " ")}
                  </li>
                ))}
              </ul>

              {review.primaryKeyword && (
                <p className="mt-1.5 text-zinc-500">
                  <span className="font-semibold">주 검색어:</span> {review.primaryKeyword}
                  {review.keywordRationale ? ` — ${review.keywordRationale}` : ""}
                </p>
              )}
              {review.titlePromise && (
                <p className="mt-0.5">
                  <span className="font-semibold text-accent">title_promise:</span> {review.titlePromise}
                </p>
              )}
              {review.thumbnailText && (
                <p className="mt-0.5 text-zinc-500">
                  <span className="font-semibold">썸네일 문구 제안:</span> {review.thumbnailText}
                </p>
              )}

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => confirmLongTitle(review.title, review.thumbnailText, review.titlePromise)}
                  disabled={!review.titlePromise}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
                    confirmedTitle === review.title
                      ? "bg-accent/20 text-accent"
                      : "bg-accent text-white hover:bg-accent-strong disabled:opacity-40"
                  }`}
                >
                  {confirmedTitle === review.title ? "✓ 확정됨" : "이 제목으로 확정"}
                </button>
                {!review.titlePromise && (
                  <span className="text-[10px] text-amber-600">
                    이 제목이 약속하는 게 없어요 — 괴리를 넣어 다시 써보세요.
                  </span>
                )}
              </div>

              {review.alternatives.length > 0 && (
                <div className="mt-2 border-t border-zinc-200 dark:border-zinc-800 pt-1.5">
                  <p className="text-[10px] font-semibold text-zinc-500">참고 대안</p>
                  <ul className="mt-1 grid gap-1">
                    {review.alternatives.map((a, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <p>{a.title}</p>
                          {a.why && <p className="text-[10px] text-zinc-500">↳ {a.why}</p>}
                        </div>
                        <button
                          onClick={() => setOwnTitle(a.title)}
                          className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                          입력창에
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 전체 구조 검수(열린 고리) + 최종 조립 출력 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <a
          href={`/api/longform/package?projectId=${encodeURIComponent(project.id)}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          📦 제작 패키지 JSON
        </a>
        <button
          onClick={genReview}
          disabled={rvBusy}
          className="text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {rvBusy ? "구조 검수 중…" : "🔍 전체 구조 검수"}
        </button>
        {rvPassed && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ 구조 검수 통과 — 열린 고리 확인됨</span>
        )}
        {rvErr && <span className="text-xs text-amber-600 dark:text-amber-400">검수 실패: {rvErr}</span>}
      </div>

      {rvStage && rvData && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3"
          onClick={() => {
            setRvStage(null);
            setRvData(null);
          }}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">🔍 롱폼 전체 구조 검수</h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">{rvData.diagnosisSummary}</p>
            {rvData.violations.length > 0 && (
              <ul className="mt-2 grid list-disc gap-0.5 pl-4 text-[11px] text-red-600">
                {rvData.violations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            )}
            {rvStage === "consent" ? (
              <>
                <p className="mt-3 text-sm font-medium">{rvData.consentQuestion}</p>
                <p className="mt-1 text-[11px] text-zinc-400">동의 전엔 원문을 바꾸지 않아요.</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setRvStage("revise")}
                    className="flex-1 rounded-lg bg-accent hover:bg-accent-strong py-2 text-sm font-medium text-white"
                  >
                    수정안 볼게요
                  </button>
                  <button
                    onClick={() => {
                      setRvStage(null);
                      setRvData(null);
                    }}
                    className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    원문대로 두기
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-xs font-semibold">수정안 · 채택할 파트 선택</p>
                <div className="mt-1 grid gap-2 text-[11px]">
                  {rvData.revisedOpening && (
                    <label className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                      <input
                        type="checkbox"
                        checked={rvPick.opening}
                        onChange={(e) => setRvPick((p) => ({ ...p, opening: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-semibold text-accent">오프닝</p>
                        <p className="mt-0.5">{rvData.revisedOpening.join(" ")}</p>
                      </div>
                    </label>
                  )}
                  {rvData.suggestedOrder && (
                    <label className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                      <input
                        type="checkbox"
                        checked={rvPick.order}
                        onChange={(e) => setRvPick((p) => ({ ...p, order: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-semibold text-accent">세그먼트 순서</p>
                        <p className="mt-0.5">{rvData.suggestedOrder.map((i) => segs[i]?.title ?? `#${i}`).join(" → ")}</p>
                      </div>
                    </label>
                  )}
                  {rvData.revisedConnectors.length > 0 && (
                    <label className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                      <input
                        type="checkbox"
                        checked={rvPick.connectors}
                        onChange={(e) => setRvPick((p) => ({ ...p, connectors: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-semibold text-accent">연결</p>
                        <ul className="mt-0.5 grid gap-0.5">
                          {rvData.revisedConnectors.map((c, i) => (
                            <li key={i}>
                              세그 {c.after}→{c.after + 1}: {c.revised}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </label>
                  )}
                  {rvData.revisedClosing && (
                    <label className="flex items-start gap-2 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
                      <input
                        type="checkbox"
                        checked={rvPick.closing}
                        onChange={(e) => setRvPick((p) => ({ ...p, closing: e.target.checked }))}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="font-semibold text-accent">마무리</p>
                        <p className="mt-0.5">{rvData.revisedClosing.join(" ")}</p>
                      </div>
                    </label>
                  )}
                  {!rvData.revisedOpening &&
                    !rvData.suggestedOrder &&
                    rvData.revisedConnectors.length === 0 &&
                    !rvData.revisedClosing && (
                      <p className="text-zinc-500">구체적 수정안이 없어요 — 진단만 참고하세요.</p>
                    )}
                </div>
                {rvData.reason && <p className="mt-2 text-[10px] text-zinc-500">↳ {rvData.reason}</p>}
                {(rvData.revisedConnectors.length > 0 || rvData.revisedClosing) && !hostProject && (
                  <p className="mt-1 text-[10px] text-amber-600">
                    연결·마무리 반영은 진행자 프로젝트가 필요해요(먼저 진행자 대본 생성).
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={applyReview}
                    className="flex-1 rounded-lg bg-accent hover:bg-accent-strong py-2 text-sm font-medium text-white"
                  >
                    선택 채택하고 반영
                  </button>
                  <button
                    onClick={() => {
                      setRvStage(null);
                      setRvData(null);
                    }}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    닫기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 진행자(마스코트) */}
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">진행자</h2>
          <button
            onClick={genHostScript}
            disabled={hostBusy || !script}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {hostBusy ? "생성 중…" : hostProject ? "씬 다시 만들기" : "진행자 씬 만들기"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          ②③④ 대본을 진행자 씬으로 펼칩니다 — 오프닝 2씬 · 브리지 {script?.bridges.length ?? 0}씬 · 엔딩 3씬.
          그 뒤 <b>진행자 편집</b>에서 씬별로 이미지·영상·음성을 만드세요(오프닝 첫 씬 = 캐릭터 확정).
        </p>
        {!script && <p className="mt-2 text-[11px] text-amber-600">먼저 ②③④ 대본을 생성해주세요.</p>}
        {hostErr && <p className="mt-2 text-[11px] text-red-600">{hostErr}</p>}
        {hostProject ? (
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2">
            <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
              {hostProject.keyframeUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hostProject.keyframeUrl} alt="진행자" className="h-full w-full object-cover" />
              ) : null}
            </div>
            <span className="flex-1 text-xs">
              호스트 씬 {hostProject.sceneCount}개
              {hostProject.finalVideoUrl ? " · 완성" : ""}
            </span>
            <Link
              href={`/project/${hostProject.id}`}
              className="shrink-0 text-[11px] rounded-md border border-accent px-2 py-1 text-accent hover:bg-accent/10"
            >
              진행자 편집 →
            </Link>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            아직 없음 — &lsquo;진행자 대본 생성&rsquo;을 눌러 시작하세요.
          </p>
        )}
      </div>

      {/* [모듈 2~4] 대본 — 오프닝 2블록 · 세그먼트 순서 + 브리지 · 엔딩 3파트 */}
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">②③④ 대본 (오프닝·브리지·엔딩)</h2>
          <button
            onClick={genScript}
            disabled={scriptBusy || !confirmedTitle}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {scriptBusy ? "생성 중…" : script ? "다시 생성" : "대본 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          오프닝(25초 이내 2블록) · 세그먼트 순서 설계 + 브리지(방점·승격·개방) · 엔딩(고리 닫기·계좌 착지·구독)을 한 번에.
          전체 고리는 <b>엔딩 파트 A 한 곳</b>에서만 닫힙니다.
        </p>
        {!confirmedTitle && (
          <p className="mt-2 text-[11px] text-amber-600">먼저 ① 제목을 확정해주세요 — title_promise 가 기준점이에요.</p>
        )}
        <label className="mt-2 flex items-center gap-1.5 text-[11px] text-zinc-500">
          <input type="checkbox" checked={fixedOrder} onChange={(e) => setFixedOrder(e.target.checked)} />
          현재 세그먼트 순서 고정(순서 제안 안 받기)
        </label>
        {scriptErr && <p className="mt-2 text-[11px] text-red-600">{scriptErr}</p>}
        {scriptViolations.length > 0 && (
          <ul className="mt-2 grid list-disc gap-0.5 pl-4 text-[10px] text-amber-600">
            {scriptViolations.map((v, i) => (
              <li key={i}>{v}</li>
            ))}
          </ul>
        )}
        {script && edit && (
          <div className="mt-2 grid gap-3">
            {/* 세그먼트 순서 */}
            <div className="text-[11px]">
              <p className="font-semibold text-zinc-600 dark:text-zinc-300">세그먼트 순서</p>
              <ol className="mt-0.5 grid gap-0.5">
                {script.segmentOrder.map((s) => (
                  <li key={s.order} className="text-zinc-500">
                    <b>{s.order}.</b> {s.title}
                    {s.rationale ? ` — ${s.rationale}` : ""}
                  </li>
                ))}
              </ol>
              {script.orderNote && <p className="mt-0.5 text-amber-600">↳ {script.orderNote}</p>}
            </div>

            {/* 오프닝 */}
            <div>
              <p className="text-[11px] font-semibold text-accent">
                오프닝 · {script.opening.estSeconds}초 (25초 이내)
              </p>
              <textarea
                value={edit.a}
                onChange={(e) => setEdit({ ...edit, a: e.target.value })}
                rows={2}
                placeholder="블록 A — 제목 호응 훅"
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2 text-xs leading-relaxed outline-none focus:border-accent"
              />
              <textarea
                value={edit.b}
                onChange={(e) => setEdit({ ...edit, b: e.target.value })}
                rows={3}
                placeholder="블록 B — 로드맵 + 착지"
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2 text-xs leading-relaxed outline-none focus:border-accent"
              />
            </div>

            {/* 브리지 */}
            <div>
              <p className="text-[11px] font-semibold text-accent">브리지 {script.bridges.length}개 (방점 / 승격 / 개방 — 줄바꿈 구분)</p>
              <div className="mt-1 grid gap-2">
                {script.bridges.map((b, i) => (
                  <div key={i}>
                    <p className="text-[10px] text-zinc-500">
                      세그 {b.afterSegment + 1} 뒤{b.isMidpointReopen ? " · 🔁 중간점 고리 환기" : ""}
                    </p>
                    <textarea
                      value={edit.bridges[i] ?? ""}
                      onChange={(e) => {
                        const next = [...edit.bridges];
                        next[i] = e.target.value;
                        setEdit({ ...edit, bridges: next });
                      }}
                      rows={3}
                      className="mt-0.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2 text-xs leading-relaxed outline-none focus:border-accent"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* 엔딩 */}
            <div>
              <p className="text-[11px] font-semibold text-accent">엔딩 · {script.ending.estSeconds}초 (25초 이내)</p>
              <textarea
                value={edit.pa}
                onChange={(e) => setEdit({ ...edit, pa: e.target.value })}
                rows={2}
                placeholder="파트 A — 고리 닫기(구체로)"
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2 text-xs leading-relaxed outline-none focus:border-accent"
              />
              <textarea
                value={edit.pb}
                onChange={(e) => setEdit({ ...edit, pb: e.target.value })}
                rows={2}
                placeholder="파트 B — 계좌 착지(중립 톤)"
                className="mt-1 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2 text-xs leading-relaxed outline-none focus:border-accent"
              />
              <p className="mt-1 rounded-lg bg-zinc-100 dark:bg-zinc-900 p-2 text-[11px] text-zinc-500">
                파트 C(표준 구독 문구): {script.ending.partCStandard}
              </p>
              {script.ending.endscreenVideo && (
                <p className="mt-1 text-[10px] text-zinc-500">
                  엔드스크린 추천: <b>{script.ending.endscreenVideo}</b> (파트 C 낭독 중 8초)
                </p>
              )}
            </div>

            <div className="flex justify-end">
              <button
                onClick={saveScript}
                disabled={scriptSaveBusy}
                className="text-[11px] rounded-md bg-accent hover:bg-accent-strong text-white px-3 py-1 disabled:opacity-40"
              >
                {scriptSaveBusy ? "저장 중…" : "대본 저장"}
              </button>
            </div>

            {Object.keys(script.screening).length > 0 && (
              <div className="rounded-lg bg-accent/5 border border-accent/30 p-2 text-[10px]">
                <p className="font-semibold text-accent">검수</p>
                <ul className="mt-0.5 grid gap-0.5">
                  {Object.entries(script.screening).map(([k, v]) => (
                    <li key={k} className={/탈락/.test(v) ? "text-red-600" : "text-zinc-500"}>
                      <b>{k}</b> — {v}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* [모듈 5] 썸네일 */}
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">⑤ 썸네일</h2>
          <button
            onClick={genThumbnail}
            disabled={thumbBusy || !confirmedTitle}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {thumbBusy ? "생성 중…" : thumb ? "다시 생성" : "썸네일 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          구도 3종으로 감정 실린 캐릭터 이미지를 만들고, 모듈 ①의 썸네일 문구를 후처리로 얹습니다(1280×720 JPG).
          168px 축소본으로 소형 판독을 검증해요.
        </p>
        {!confirmedTitle && <p className="mt-2 text-[11px] text-amber-600">먼저 ① 제목을 확정해주세요.</p>}
        {thumbErr && <p className="mt-2 text-[11px] text-red-600">{thumbErr}</p>}
        {thumb && (
          <div className="mt-2 grid gap-2">
            <p className="text-[11px]">
              <span className="font-semibold text-accent">글씨:</span> {thumb.textUsed}
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {thumb.variants.map((v, i) => (
                <div
                  key={i}
                  className={`rounded-lg border p-1.5 ${thumb.selected && thumb.selected === v.fileUrl ? "border-accent bg-accent/10" : "border-zinc-200 dark:border-zinc-800"}`}
                >
                  {v.fileUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.fileUrl} alt={`시안 ${i + 1}`} className="w-full rounded aspect-[16/9] object-cover" />
                  ) : (
                    <div className="aspect-[16/9] w-full rounded bg-zinc-100 dark:bg-zinc-900" />
                  )}
                  <p className="mt-1 text-[10px] text-zinc-500 line-clamp-2">{v.composition}</p>
                  <div className="mt-1 flex items-center gap-1.5">
                    {v.previewUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={v.previewUrl} alt="168px 검증본" width={84} className="rounded border border-zinc-300 dark:border-zinc-700" />
                    )}
                    <div className="flex flex-col gap-1">
                      {v.fileUrl && (
                        <a
                          href={v.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[10px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                        >
                          ⬇ 원본
                        </a>
                      )}
                      {v.fileUrl && (
                        <button
                          onClick={() => selectThumbnail(v.fileUrl!)}
                          className="rounded-md bg-accent px-2 py-0.5 text-[10px] font-medium text-white hover:bg-accent-strong"
                        >
                          {thumb.selected === v.fileUrl ? "✓ 선택됨" : "선택"}
                        </button>
                      )}
                    </div>
                  </div>
                  {typeof v.strokePx === "number" && v.strokePx < 2 && (
                    <p className="mt-1 text-[10px] text-amber-600">⚠ 168px에서 획이 얇아요({v.strokePx}px)</p>
                  )}
                </div>
              ))}
            </div>
            <p className="text-[10px] text-zinc-500">
              업로드할 때 유튜브 스튜디오 <b>테스트 및 비교</b>에 시안 3종을 걸어 시청 데이터로 승자를 고르세요(원칙 7).
            </p>
            {Object.keys(thumb.screening).length > 0 && (
              <ul className="grid gap-0.5 text-[10px] text-zinc-500">
                {Object.entries(thumb.screening).map(([k, v]) => (
                  <li key={k} className={/탈락/.test(v) ? "text-red-600" : ""}>
                    <b>{k}</b> — {v}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 재생 순서 타임라인 — 오프닝 → 세그1 → 연결1/2 → 세그2 → … → 마지막 세그 → 엔딩.
          실제 영상이 나가는 순서 그대로 보여준다(세그먼트 목록만 따로 보면 순서가 안 보임). */}
      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">재생 순서 ({readyCount}/{segs.length} 세그먼트 완성)</h2>
        {script && (
          <span className="text-[10px] text-zinc-500">
            진행자 오프닝 {script.opening.estSeconds}s · 엔딩 {script.ending.estSeconds}s
          </span>
        )}
      </div>
      <ol className="mt-2 grid gap-1.5">
        {/* 오프닝 */}
        <li className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 p-2">
          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold text-white">
            오프닝
          </span>
          <span className="flex-1 text-[11px] line-clamp-2 text-zinc-600 dark:text-zinc-300">
            {script ? `${script.opening.blockAHook} ${script.opening.blockBRoadmapLanding}` : "대본 미생성"}
          </span>
          {script && (
            <span className="shrink-0 text-[10px] text-zinc-500">{script.opening.estSeconds}s</span>
          )}
        </li>

        {segs.map((s, i) => {
          const bridge = script?.bridges.find((b) => b.afterSegment === i);
          const isLast = i === segs.length - 1;
          return (
            <li key={s.id} className="grid gap-1.5">
              {/* 세그먼트 */}
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-2">
                <div className="flex flex-col shrink-0">
                  <button
                    onClick={() => moveSeg(i, -1)}
                    disabled={i === 0 || reordering}
                    aria-label="위로"
                    className="leading-none text-[10px] text-zinc-500 hover:text-accent disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveSeg(i, 1)}
                    disabled={isLast || reordering}
                    aria-label="아래로"
                    className="leading-none text-[10px] text-zinc-500 hover:text-accent disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <span className="shrink-0 rounded bg-zinc-200 dark:bg-zinc-800 px-1.5 py-0.5 text-[9px] font-bold text-zinc-600 dark:text-zinc-300">
                  세그 {i + 1}
                </span>
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
                  {s.keyframeUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.keyframeUrl} alt={s.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <span className="flex-1 text-xs line-clamp-2">{s.title}</span>
                <span
                  className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                    s.finalVideoUrl
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {s.finalVideoUrl ? "완성" : "미완성"}
                </span>
                <Link
                  href={`/project/${s.id}`}
                  className="shrink-0 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                >
                  편집
                </Link>
              </div>

              {/* 연결 i/i+1 — 마지막 세그먼트 뒤엔 연결이 없다(엔딩으로 간다) */}
              {!isLast && (
                <div className="ml-6 flex items-center gap-2 rounded-lg border border-dashed border-accent/40 bg-accent/[0.03] px-2 py-1.5">
                  <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold text-accent">
                    연결 {i + 1}/{i + 2}
                  </span>
                  <span className="flex-1 text-[11px] line-clamp-1 text-zinc-600 dark:text-zinc-300">
                    {bridge
                      ? [bridge.emphasis, bridge.elevation, bridge.opening].filter(Boolean).join(" ")
                      : "대본 미생성"}
                  </span>
                  {bridge?.isMidpointReopen && (
                    <span className="shrink-0 text-[9px] text-accent">🔁 고리 환기</span>
                  )}
                  {bridge && (
                    <span className="shrink-0 text-[10px] text-zinc-500">
                      {bridgeSeconds(bridge)}s
                    </span>
                  )}
                </div>
              )}
            </li>
          );
        })}

        {/* 엔딩 */}
        <li className="flex items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 p-2">
          <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold text-white">
            엔딩
          </span>
          <span className="flex-1 text-[11px] line-clamp-2 text-zinc-600 dark:text-zinc-300">
            {script
              ? `${script.ending.partAClose} ${script.ending.partBLanding} ${script.ending.partCStandard}`
              : "대본 미생성"}
          </span>
          {script && (
            <span className="shrink-0 text-[10px] text-zinc-500">{script.ending.estSeconds}s</span>
          )}
        </li>
      </ol>

      {/* 합성 — 섹션이 있으면 섹션별 부분 합성 + 최종 이어붙이기, 없으면 레거시 단일 합성 */}
      {hasSections ? (
        <div className="mt-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">섹션별 부분 합성 ({secReadyCount}/{secList.length})</h2>
          </div>
          <p className="mt-1 text-[11px] text-zinc-500">
            세그먼트를 2~3편씩 섹션으로 나눠 <b>섹션별로</b> 굽습니다(한 번에 몰지 않아 서버 부담↓).
            섹션을 전부 합성한 뒤 <b>최종 이어붙이기</b>를 누르세요.
          </p>
          <ol className="mt-2 grid gap-2">
            {secList.map((sec, si) => {
              const segInfos = sec.segmentIds
                .map((id) => segs.find((s) => s.id === id))
                .filter((s): s is SegInfo => !!s);
              const segReady = segInfos.length > 0 && segInfos.every((s) => s.finalVideoUrl);
              const gen = sec.status === "generating";
              const done = !!sec.videoUrl;
              return (
                <li
                  key={sec.id}
                  className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-2.5"
                >
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-xs font-bold text-zinc-400">섹션 {si + 1}</span>
                    <span className="flex-1 text-[11px] text-zinc-500 line-clamp-1">
                      세그 {sec.segmentIds.length}편 · {segInfos.map((s) => s.title).join(" · ")}
                    </span>
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        gen
                          ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
                          : done
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                            : sec.status === "error"
                              ? "bg-red-500/10 text-red-600 dark:text-red-400"
                              : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      {gen ? "합성 중" : done ? "완성" : sec.status === "error" ? "에러" : "미합성"}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <button
                      onClick={() => composeSection(sec.id)}
                      disabled={!segReady || gen || composing}
                      className="rounded-md bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-[11px] font-medium px-3 py-1"
                    >
                      {gen ? "합성 중…" : done ? "다시 합성" : "부분 합성"}
                    </button>
                    {done && (
                      <a
                        href={sec.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                      >
                        ▶ 미리보기
                      </a>
                    )}
                    {!segReady && (
                      <span className="text-[11px] text-amber-600">세그먼트 먼저 완성</span>
                    )}
                  </div>
                  {sec.error && <p className="mt-1 text-[11px] text-red-600">{sec.error}</p>}
                </li>
              );
            })}
          </ol>

          {/* 최종 이어붙이기 */}
          <div className="mt-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
            <button
              onClick={startJoin}
              disabled={!allSecReady || composing}
              className="w-full rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium py-2"
            >
              {composing
                ? "이어붙이는 중…"
                : allSecReady
                  ? "🔗 최종 이어붙이기"
                  : `섹션 합성 대기 (${secReadyCount}/${secList.length})`}
            </button>
            {composing && (
              <p className="mt-2 text-[11px] text-zinc-500">
                상태: {status} {progress ? `· ${progress}` : ""}
              </p>
            )}
            {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
          <button
            onClick={startCompose}
            disabled={!allReady || composing}
            className="w-full rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium py-2"
          >
            {composing ? "합성 중…" : allReady ? "롱폼 합성" : `세그먼트 완성 대기 (${readyCount}/${segs.length})`}
          </button>
          {composing && (
            <p className="mt-2 text-[11px] text-zinc-500">
              상태: {status} {progress ? `· ${progress}` : ""}
            </p>
          )}
          {error && <p className="mt-2 text-[11px] text-red-600">{error}</p>}
        </div>
      )}

      {/* 결과 */}
      {finalUrl && (
        <div className="mt-5">
          <h2 className="text-sm font-semibold mb-2">완성 영상</h2>
          <video
            src={finalUrl}
            controls
            playsInline
            className="w-full aspect-[16/9] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-black"
          />
          <a
            href={`/api/download?projectId=${encodeURIComponent(project.id)}`}
            className="mt-2 inline-block text-xs rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            ⬇ 다운로드
          </a>
        </div>
      )}

      {/* 고정 푸터에 가리지 않게 여백 */}
      <div className="h-16" />

      {/* 롱폼 제작 비용 — 롱폼 자신 + 세그먼트 전부 + 진행자 합산(숏폼 Studio 와 같은 위치). */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-white/90 dark:bg-black/80 backdrop-blur px-4 py-2.5">
        <p className="md:max-w-2xl md:mx-auto text-center text-xs text-zinc-600 dark:text-zinc-300">
          롱폼 제작 비용 <span className="font-semibold text-accent">{cost?.totalKrw ?? "₩0"}</span>
          {cost?.segments && (
            <span className="ml-1.5 text-[10px] text-zinc-500">
              (세그먼트 {cost.segCount ?? 0}편 {cost.segments}
              {cost.host ? ` · 진행자 ${cost.host}` : ""}
              {cost.own ? ` · 대본·썸네일 ${cost.own}` : ""})
            </span>
          )}
        </p>
      </div>
    </main>
  );
}
