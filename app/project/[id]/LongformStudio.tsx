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
import type { Chipset, ChipsetStage } from "@/lib/chipsets";
import ChipsetRow from "./ChipsetRow";
import Studio from "./Studio";
import type { Project } from "@/lib/types";
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

interface HostScene {
  index: number;
  hostSlot?: "opening" | "connector" | "closing";
  connectorAfter?: number;
  narration: string;
  imageUrl?: string;
  videoUrl?: string;
  durationSec: number;
}

interface HostProject {
  id: string;
  title: string;
  keyframeUrl?: string;
  sceneCount: number;
  finalVideoUrl?: string;
  scenes?: HostScene[];
}

// 롱폼 전용 화면 — 제작 파이프라인(모듈 1 제목 → 2~4 대본 → 5 썸네일)과 세그먼트 완성
// 현황을 보여주고, 전부 완성되면 섹션별 부분 합성 → 최종 이어붙이기를 돌린다.
// 세그먼트 재생성은 각 세그먼트 프로젝트(스튜디오)에서 하고, 여기선 상태만 모아 본다.
export default function LongformStudio({
  project,
  segments,
  hostProject,
  hostFull,
  studioProps,
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
  // ★ 진행자 씬은 숏폼과 똑같은 화면(Studio)으로 만든다 — 그림·영상·음성·칩셋 전부 같은 것.
  hostFull: Project | null;
  studioProps: {
    styleProfiles: { id: string; label: string }[];
    videoModels: { id: string; label: string }[];
    tts?: {
      default: "elevenlabs" | "typecast";
      configured: { elevenlabs: boolean; typecast: boolean };
      typecastVoices?: { fallback: boolean; perLang: Record<string, boolean> };
    };
  };
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
      // 제목 약속이 답으로 적히면 오프닝이 답을 미리 말한다 — 막지는 않고 여기서 알린다.
      setPromiseWarn(Array.isArray(d.promiseWarnings) ? (d.promiseWarnings as string[]) : []);
      refreshCost();
    } catch (e) {
      setTitleErr(e instanceof Error ? e.message : "확정 실패");
    }
  }

  // 직접 쓴 제목 검증 — 원칙으로 진단만 받는다(확정은 따로).
  // 제목 약속(title_promise) 경고 — 이 값이 오프닝·엔딩 전부의 기준점이라 답이 적히면 안 된다.
  const [promiseWarn, setPromiseWarn] = useState<string[]>([]);
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

  // ── [모듈 2~4] 대본 트랙 — 오프닝(2블록) · 세그먼트 순서 + 브리지 · 엔딩(3파트).
  const [script, setScript] = useState<LongformScriptPackage | null>(initialScript);
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptSaveBusy, setScriptSaveBusy] = useState(false);
  const [scriptErr, setScriptErr] = useState("");
  const [scriptViolations, setScriptViolations] = useState<string[]>([]);
  // 편 순서는 고른 순서 그대로 간다 — 모델이 제안한 순서로 갈아치우지 않는다(지시).
  // 순서를 바꾸려면 ③ 목록에서 ▲▼ 로 직접 옮긴다.
  const fixedOrder = true;
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
      router.refresh(); // 대본을 쓰면 씬도 서버에서 같이 갱신된다 — 아래 편집 화면을 다시 읽는다
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
      router.refresh(); // 고친 말이 씬 나레이션에도 반영됐으니 아래 편집 화면을 다시 읽는다
    } catch (e) {
      setScriptErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setScriptSaveBusy(false);
    }
  }

  // 🧩 내 칩셋 — 계정 단위로 저장해 둔 프롬프트 조각(쇼츠 Studio 와 같은 것을 그대로 쓴다).
  // 썸네일도 그림을 만드는 일이라 스타일 칩이 필요하다(사용자 지정 2026-08-01).
  const [chipsets, setChipsets] = useState<Chipset[]>([]);
  const [thumbChips, setThumbChips] = useState<string[]>(initialThumbnail?.settings?.chipIds ?? []);
  const [thumbExtra, setThumbExtra] = useState(initialThumbnail?.settings?.extra ?? "");
  // ★ 지난번에 쓴 설정 그대로 시작한다 — 다시 만들 때 또 고르게 하지 않는다.
  const [thumbTextEdit, setThumbTextEdit] = useState(initialThumbnail?.textUsed ?? "");
  // 숏폼 이미지 화면과 같은 조작 — 모드(스타일 프로파일)·품질.
  const [thumbStyleId, setThumbStyleId] = useState(
    initialThumbnail?.settings?.styleProfileId ?? studioProps.styleProfiles[0]?.id ?? ""
  );
  const [thumbQuality, setThumbQuality] = useState<"low" | "medium" | "high">(
    initialThumbnail?.settings?.quality ?? "medium"
  );
  useEffect(() => {
    fetch("/api/chipsets")
      .then((r) => r.json())
      .then((d) => {
        if (d?.ok && Array.isArray(d.chipsets)) setChipsets(d.chipsets as Chipset[]);
      })
      .catch(() => {});
  }, []);

  async function addChipset(input: { stage: ChipsetStage; label: string; text: string }) {
    try {
      const r = await fetch("/api/chipsets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) return (d?.error as string) || "칩 저장 실패";
      setChipsets(d.chipsets as Chipset[]);
      return null;
    } catch {
      return "칩 저장 실패";
    }
  }
  async function editChipset(id: string, patch: { label: string; text: string }) {
    try {
      const r = await fetch("/api/chipsets", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, ...patch }),
      });
      const d = await r.json();
      if (!r.ok || !d.ok) return (d?.error as string) || "칩 수정 실패";
      setChipsets(d.chipsets as Chipset[]);
      return null;
    } catch {
      return "칩 수정 실패";
    }
  }
  async function removeChipset(id: string) {
    try {
      const r = await fetch(`/api/chipsets?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const d = await r.json();
      if (d?.ok) setChipsets(d.chipsets as Chipset[]);
      setThumbChips((prev) => prev.filter((x) => x !== id));
    } catch {
      /* 무시 */
    }
  }
  async function reorderChipsetsFor(stage: ChipsetStage, ids: string[]) {
    setChipsets((prev) => {
      const rank = new Map(ids.map((id, i) => [id, i]));
      return [...prev].sort((a, b) => {
        if (a.stage !== stage || b.stage !== stage) return 0;
        return (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0);
      });
    });
    try {
      await fetch("/api/chipsets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reorder: { stage, ids } }),
      });
    } catch {
      /* 무시 — 화면 순서는 이미 바뀌었다 */
    }
  }

  // ★ 고른 설정은 곧바로 저장한다 — 생성 전에 리로드해도 남아야 한다(사용자 지적 2026-08-01).
  // 첫 렌더에서는 저장하지 않는다(서버에서 받은 값을 그대로 되쓰는 낭비를 막는다).
  const thumbSettingsReady = useRef(false);
  useEffect(() => {
    if (!thumbSettingsReady.current) {
      thumbSettingsReady.current = true;
      return;
    }
    const t = setTimeout(() => {
      fetch("/api/longform/thumbnail", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          settingsOnly: true,
          styleProfileId: thumbStyleId || undefined,
          quality: thumbQuality,
          chipIds: thumbChips,
          styleExtra: thumbExtra,
          text: thumbTextEdit,
        }),
      }).catch(() => {});
    }, 600); // 타이핑이 멈추면 저장
    return () => clearTimeout(t);
  }, [project.id, thumbStyleId, thumbQuality, thumbChips, thumbExtra, thumbTextEdit]);

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
        body: JSON.stringify({
          projectId: project.id,
          // 켜 둔 스타일 칩 + 직접 쓴 지시를 그림 프롬프트 뒤에 붙인다.
          styleExtra: [
            ...chipsets.filter((c) => thumbChips.includes(c.id)).map((c) => c.text),
            thumbExtra.trim(),
          ]
            .filter(Boolean)
            .join(". "),
          ...(thumbTextEdit.trim() ? { text: thumbTextEdit.trim() } : {}),
          styleProfileId: thumbStyleId || undefined,
          quality: thumbQuality,
          chipIds: thumbChips,
        }),
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

  // ★ 서버가 새 prop 을 내려주면 로컬 상태에 반영한다.
  // useState(initial) 는 최초 1회만 쓰이므로, router.refresh() 로 서버 컴포넌트가 다시
  // 그려져도 여기 상태는 옛 값 그대로였다 — "생성했는데 화면에 안 뜬다"의 원인.
  // (대본 생성이 순서를 재배치하거나, 진행자 씬을 새로 만들었을 때 특히 티가 났다.)
  useEffect(() => {
    setSegs(segments);
  }, [segments]);
  useEffect(() => {
    setSecList(project.sections ?? []);
  }, [project.sections]);
  useEffect(() => {
    setFinalUrl(project.finalVideoUrl);
  }, [project.finalVideoUrl]);
  useEffect(() => {
    setLfTitle(project.title);
  }, [project.title]);
  // 대본·제목·썸네일도 같은 이유로 동기화 — 전체 다듬기 채택 후 router.refresh() 하면
  // 서버가 새 대본을 내려주는데, 이게 없으면 화면엔 옛 문장이 남는다.
  useEffect(() => {
    if (initialScript) {
      setScript(initialScript);
      loadEdit(initialScript);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialScript]);
  useEffect(() => {
    if (initialTitle) setTitlePkg(initialTitle);
  }, [initialTitle]);
  useEffect(() => {
    if (initialThumbnail) setThumb(initialThumbnail);
  }, [initialThumbnail]);

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

  // ── 재생 순서 작업판 — 실제로 나가는 순서(오프닝 → 세그 → 연결 → … → 엔딩)가 화면의 뼈대다.
  // 진행자 구간은 별도 프로젝트의 씬이라, 여기서 씬 단위로 상태를 같이 봐야 진행이 읽힌다.
  const hostScenes = hostProject?.scenes ?? [];
  const openingScenes = hostScenes.filter((s) => s.hostSlot === "opening");
  const closingScenes = hostScenes.filter((s) => s.hostSlot === "closing");
  const connectorScene = (i: number) =>
    hostScenes.find((s) => s.hostSlot === "connector" && (s.connectorAfter ?? 0) === i);
  const hostVideoDone = hostScenes.filter((s) => !!s.videoUrl).length;
  // 엔딩 마지막 줄(구독)은 고정 문구다 — 여운이 비어 있으면 그 자리 씬이 없다(빈 씬을 안 만든다).
  const hasLanding = !!script?.ending.partBLanding.trim();

  // 진행자 한 줄 — 대본을 그 자리에서 고치고, 그 씬의 그림·영상 상태를 함께 본다.
  const hostRow = (
    key: string,
    label: string,
    value: string,
    onChange: ((v: string) => void) | null,
    scene?: HostScene,
    note?: string
  ) => (
    <div
      key={key}
      className="ml-6 rounded-lg border border-dashed border-accent/40 bg-accent/[0.03] px-2 py-1.5"
    >
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[9px] font-bold text-accent">
          {label}
        </span>
        <span className="flex-1 text-[10px] text-zinc-500">
          {scene
            ? `${scene.imageUrl ? "🖼" : "·"} ${scene.videoUrl ? "🎬" : "·"} ${scene.durationSec}s`
            : script
              ? "씬 미생성"
              : "대본 미생성"}
        </span>
        {scene && (
          <span className="shrink-0 text-[10px] text-zinc-400">아래에서 편집</span>
        )}
      </div>
      {onChange ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-zinc-200 bg-transparent p-1.5 text-[11px] dark:border-zinc-800"
        />
      ) : (
        <p className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-300">{value}</p>
      )}
      {note && <p className="mt-0.5 text-[10px] text-zinc-400">{note}</p>}
    </div>
  );

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
        가로 16:9 롱폼 — 아래 순서 그대로 이어붙습니다. 칸마다 말을 고치고, 각 편은 편집에서 완성하세요.
      </p>

      {/* [모듈 1] 롱폼 제목 — 검색 5원칙 */}
      <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">① 제목</h2>
          <button
            onClick={genLongTitle}
            disabled={titleBusy}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {titleBusy ? "생성 중…" : titlePkg ? "다시 생성" : "제목 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          어긋나는 두 사실로 궁금하게 만들되 답은 주지 않습니다. 구성한 편들에 실제로 있는 사실만 씁니다.
          <b> 제목을 확정해야</b> 썸네일과 대본을 만들 수 있어요 — 제목이 약속한 궁금증이 그 뒤 전부의 기준점이라서요.
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
            <h3 className="text-sm font-semibold">✍️ 롱폼 전체 다듬기</h3>
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


      {/* [모듈 5] 썸네일 */}
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">② 썸네일</h2>
          <button
            onClick={genThumbnail}
            disabled={thumbBusy || !confirmedTitle}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {thumbBusy ? "생성 중…" : thumb ? "다시 생성" : "썸네일 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          구도 3종으로 감정 실린 캐릭터 이미지를 만들고, ① 제목에서 정한 썸네일 문구를 후처리로 얹습니다(1280×720 JPG).
          168px 축소본으로 소형 판독을 검증해요.
        </p>
        {!confirmedTitle && <p className="mt-2 text-[11px] text-amber-600">먼저 ① 제목을 확정해주세요.</p>}

        {/* 그림 조정 — 썸네일도 그림을 만드는 일이라 스타일 칩과 직접 지시가 필요하다.
            칩은 쇼츠 Studio 와 같은 계정 칩셋을 그대로 쓴다(따로 만들지 않는다). */}
        <div className="mt-2 grid gap-1.5">
          <div className="flex flex-wrap gap-3">
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-zinc-500">모드</span>
              <select
                value={thumbStyleId}
                onChange={(e) => setThumbStyleId(e.target.value)}
                disabled={thumbBusy}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
              >
                {studioProps.styleProfiles.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-zinc-500">품질</span>
              <select
                value={thumbQuality}
                onChange={(e) => setThumbQuality(e.target.value as "low" | "medium" | "high")}
                disabled={thumbBusy}
                className="rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950"
              >
                <option value="low">빠름·저렴</option>
                <option value="medium">보통</option>
                <option value="high">고품질</option>
              </select>
            </label>
          </div>
          <ChipsetRow
            stage="style"
            chipsets={chipsets}
            activeIds={thumbChips}
            onToggle={(c) =>
              setThumbChips((prev) => (prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]))
            }
            onAdd={addChipset}
            onUpdate={editChipset}
            onDelete={removeChipset}
            onReorder={reorderChipsetsFor}
            disabled={thumbBusy}
            hint="켜 둔 칩이 썸네일 그림 프롬프트 뒤에 붙습니다"
          />
          <div className="grid gap-1.5 sm:grid-cols-2">
            <label className="grid gap-0.5">
              <span className="text-[10px] text-zinc-500">썸네일 글씨 (비우면 제목에서 정한 문구)</span>
              <input
                value={thumbTextEdit}
                onChange={(e) => setThumbTextEdit(e.target.value)}
                placeholder={titlePkg?.finalThumbnailText ?? ""}
                disabled={thumbBusy}
                className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-[11px] dark:border-zinc-800"
              />
            </label>
            <label className="grid gap-0.5">
              <span className="text-[10px] text-zinc-500">그림 지시 직접 쓰기 (영문·한글 모두 가능)</span>
              <input
                value={thumbExtra}
                onChange={(e) => setThumbExtra(e.target.value)}
                placeholder="예: 어두운 배경, 클로즈업"
                disabled={thumbBusy}
                className="rounded-md border border-zinc-200 bg-transparent px-2 py-1 text-[11px] dark:border-zinc-800"
              />
            </label>
          </div>
        </div>

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


      {/* ★ 재생 순서 = 이 화면의 뼈대. 오프닝 → 세그1 → 연결 → 세그2 → … → 엔딩 순으로,
          진행자 구간은 씬 단위로 펼쳐 그 자리에서 대본을 고친다. 제목·썸네일 등 나머지 도구는
          이 아래에 접어 둔다(사용자 지정 2026-07-26: 머릿속 구조가 곧 화면 구조여야 한다). */}
      <div className="mt-4 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          ③ 대본 <span className="text-[11px] font-normal text-zinc-500">
            (편 {readyCount}/{segs.length} · 진행자 {hostVideoDone}/{hostScenes.length || 0})
          </span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {!script && (
            <button
              onClick={genScript}
              disabled={scriptBusy || !confirmedTitle}
              className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white hover:bg-accent-strong disabled:opacity-40"
              title={confirmedTitle ? "오프닝·연결·엔딩을 한 번에 씁니다" : "먼저 제목을 확정해주세요"}
            >
              {scriptBusy ? "쓰는 중…" : "대본 만들기"}
            </button>
          )}
          {script && edit && (
            <button
              onClick={saveScript}
              disabled={scriptSaveBusy}
              className="rounded-lg border border-zinc-300 px-2.5 py-1 text-[11px] font-medium hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              {scriptSaveBusy ? "저장 중…" : "대본 저장"}
            </button>
          )}
        </div>
      </div>
      {scriptErr && <p className="mt-1 text-[11px] text-red-600">{scriptErr}</p>}
      {scriptViolations.length > 0 && (
        <ul className="mt-1 grid list-disc gap-0.5 pl-4 text-[10px] text-amber-600">
          {scriptViolations.map((v, i) => (
            <li key={i}>{v}</li>
          ))}
        </ul>
      )}
      {script && Object.keys(script.screening).length > 0 && (
        <ul className="mt-1 grid gap-0.5 text-[10px]">
          {Object.entries(script.screening).map(([k, v]) => (
            <li key={k} className={/탈락/.test(v) ? "text-red-600" : "text-zinc-500"}>
              <b>{k}</b> — {v}
            </li>
          ))}
        </ul>
      )}
      {!script && (
        <p className="mt-1 text-[11px] text-amber-600">
          {confirmedTitle
            ? "대본이 아직 없어요 — 위 “대본 만들기”를 눌러주세요."
            : "먼저 제목을 확정해주세요 — 제목이 약속한 궁금증이 오프닝·엔딩의 기준점이에요."}
        </p>
      )}
      {promiseWarn.length > 0 && (
        <div className="mt-1 rounded-lg border border-amber-300 bg-amber-50 p-2 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-[11px] font-semibold text-amber-700 dark:text-amber-400">
            제목이 약속한 궁금증을 다시 보세요
          </p>
          <ul className="mt-0.5 grid list-disc gap-0.5 pl-4 text-[11px] text-amber-700 dark:text-amber-400">
            {promiseWarn.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
          <p className="mt-0.5 text-[10px] text-amber-600">
            이대로 두면 오프닝이 답을 미리 말하고 엔딩이 같은 말을 반복합니다.
          </p>
        </div>
      )}

      <ol className="mt-2 grid gap-1.5">
        {/* 오프닝 — 씬 2개 */}
        {script && edit
          ? [
              hostRow("op-a", "오프닝 1", edit.a, (v) => setEdit({ ...edit, a: v }), openingScenes[0]),
              hostRow("op-b", "오프닝 2", edit.b, (v) => setEdit({ ...edit, b: v }), openingScenes[1]),
            ]
          : hostRow("op-none", "오프닝", "대본 미생성", null)}

        {segs.map((s, i) => {
          const isLast = i === segs.length - 1;
          return (
            <li key={s.id} className="grid gap-1.5">
              <div className="flex items-center gap-2 rounded-xl border border-zinc-200 p-2 dark:border-zinc-800">
                <div className="flex shrink-0 flex-col">
                  <button
                    onClick={() => moveSeg(i, -1)}
                    disabled={i === 0 || reordering}
                    aria-label="위로"
                    className="text-[10px] leading-none text-zinc-500 hover:text-accent disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => moveSeg(i, 1)}
                    disabled={isLast || reordering}
                    aria-label="아래로"
                    className="text-[10px] leading-none text-zinc-500 hover:text-accent disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-[9px] font-bold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                  {i + 1}편
                </span>
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
                  {s.keyframeUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.keyframeUrl} alt={s.title} className="h-full w-full object-cover" />
                  ) : null}
                </div>
                <span className="line-clamp-2 flex-1 text-xs">{s.title}</span>
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
                  className="shrink-0 rounded-md border border-zinc-300 px-2 py-0.5 text-[11px] hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                >
                  편집
                </Link>
              </div>

              {/* 연결 — 마지막 편 뒤엔 없다(엔딩으로 간다) */}
              {!isLast &&
                (script && edit && edit.bridges[i] !== undefined
                  ? hostRow(
                      `br-${i}`,
                      `연결 ${i + 1}→${i + 2}`,
                      edit.bridges[i],
                      (v) => {
                        const next = [...edit.bridges];
                        next[i] = v;
                        setEdit({ ...edit, bridges: next });
                      },
                      connectorScene(i),
                      "줄바꿈으로 세 역할 구분 — 앞줄부터 방점 / 승격 / 개방"
                    )
                  : hostRow(`br-${i}-none`, `연결 ${i + 1}→${i + 2}`, "대본 미생성", null))}
            </li>
          );
        })}

        {/* 엔딩 — 답 · (여운) · 구독 고정 문구 */}
        {script && edit
          ? [
              hostRow("en-a", "엔딩 답", edit.pa, (v) => setEdit({ ...edit, pa: v }), closingScenes[0]),
              hostRow(
                "en-b",
                "엔딩 여운",
                edit.pb,
                (v) => setEdit({ ...edit, pb: v }),
                hasLanding ? closingScenes[1] : undefined,
                "비워두는 게 기본입니다 — 투자 조언은 절대 넣지 않습니다"
              ),
              hostRow(
                "en-c",
                "구독",
                script.ending.partCStandard,
                null,
                closingScenes[hasLanding ? 2 : 1],
                "채널 고정 문구 — 고치지 않습니다"
              ),
            ]
          : hostRow("en-none", "엔딩", "대본 미생성", null)}
      </ol>

      {/* ★ 진행자 씬 편집 — 숏폼 편집 화면을 그대로 쓴다(사용자 지정 2026-08-01).
          오프닝·연결·엔딩 씬의 그림·영상·음성·칩셋·자막이 숏폼과 똑같이 뜬다.
          따로 만들지 마라 — 만들면 또 반쪽짜리가 된다. */}
      {hostFull && (
        <div className="mt-6 rounded-xl border border-accent/40 p-2">
          <p className="px-1 pb-1 text-[11px] text-zinc-500">
            아래는 <b>오프닝 · 연결 · 엔딩</b> 편집이에요 — 숏폼과 같은 화면입니다.
          </p>
          <Studio
            project={hostFull}
            styleProfiles={studioProps.styleProfiles}
            videoModels={studioProps.videoModels}
            tts={studioProps.tts}
          />
        </div>
      )}

      {/* 손보기 도구 — 재생 순서에서 바로 고치는 게 기본이지만, 이전 단계(진행자 대본 생성·
          전체 다듬기·씬 펼치기)는 그대로 보여야 한다. 접어서 안 보이게 하지 마라
          (2026-08-01: 접었더니 단계를 날린 것처럼 됐다). 접고 싶으면 사용자가 직접 접는다. */}
      <details open className="mt-5 group">
        <summary className="cursor-pointer list-none rounded-xl border border-zinc-200 px-3 py-2 text-sm font-semibold hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900">
          <span className="group-open:hidden">▸ </span>
          <span className="hidden group-open:inline">▾ </span>
          손보기 도구
          <span className="ml-1 text-[11px] font-normal text-zinc-500">
            전체 다듬기
          </span>
        </summary>

      {/* 전체 다듬기 — 세그먼트 대본까지 통째로 읽고 훅 구조·순서·진행자 멘트를 손본다.
          대본이 있어야 의미가 있으므로 대본 패널 바로 뒤에 둔다. */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={genReview}
          disabled={rvBusy || !script}
          title="세그먼트 대본까지 다 읽고 전체 훅 구조를 점검 — 세그먼트 순서·오프닝·연결·엔딩 수정안을 제안합니다(세그먼트 문장은 안 건드림)"
          className="text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
        >
          {rvBusy ? "다듬는 중…" : "✍️ 전체 다듬기 (훅 구조·순서)"}
        </button>
        <a
          href={`/api/longform/package?projectId=${encodeURIComponent(project.id)}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          📦 제작 패키지 JSON
        </a>
        {rvPassed && (
          <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ 다듬을 곳 없어요 — 고리 구조 확인됨</span>
        )}
        {rvErr && <span className="text-xs text-amber-600 dark:text-amber-400">실패: {rvErr}</span>}
      </div>
      {!script && (
        <p className="mt-1 text-[11px] text-zinc-500">
          전체 다듬기는 대본을 만든 뒤에 쓸 수 있어요.
        </p>
      )}


      </details>


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
