"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { LongformOpening } from "@/lib/types";

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

// 롱폼 전용 화면 — 세그먼트(16:9로 재합성한 숏폼) 완성 현황을 보여주고,
// 전부 완성되면 "롱폼 합성"(세그먼트 완성본 + 아이캐치 이어붙이기)을 돌린다.
// 세그먼트 재생성은 각 세그먼트 프로젝트(스튜디오)에서 하고, 여기선 상태만 모아 본다.
export default function LongformStudio({
  project,
  segments,
  hostProject,
  initialOpening,
}: {
  project: { id: string; title: string; finalVideoUrl?: string; eyecatchUrl?: string };
  segments: SegInfo[];
  hostProject: HostProject | null;
  initialOpening: LongformOpening | null;
}) {
  const router = useRouter();
  const [hostBusy, setHostBusy] = useState(false);
  const [hostErr, setHostErr] = useState("");

  // 열린 고리 오프닝
  const [opening, setOpening] = useState<LongformOpening | null>(initialOpening);
  const [openScript, setOpenScript] = useState((initialOpening?.script ?? []).join("\n"));
  const [openBusy, setOpenBusy] = useState(false);
  const [openSaveBusy, setOpenSaveBusy] = useState(false);
  const [openErr, setOpenErr] = useState("");

  async function genOpening() {
    setOpenBusy(true);
    setOpenErr("");
    try {
      const r = await fetch("/api/longform/opening", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "오프닝 생성 실패");
      setOpening(d.opening);
      setOpenScript((d.opening?.script ?? []).join("\n"));
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : "오프닝 생성 실패");
    } finally {
      setOpenBusy(false);
    }
  }

  async function saveOpening() {
    const script = openScript.split("\n").map((l) => l.trim()).filter(Boolean);
    if (script.length === 0) return;
    setOpenSaveBusy(true);
    setOpenErr("");
    try {
      const r = await fetch("/api/longform/opening", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, script }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "저장 실패");
      setOpening(d.opening);
    } catch (e) {
      setOpenErr(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setOpenSaveBusy(false);
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
  const [eyecatchUrl, setEyecatchUrl] = useState<string | undefined>(project.eyecatchUrl);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [segs, setSegs] = useState(segments); // 순서 변경용 로컬 상태
  const [reordering, setReordering] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const readyCount = segs.filter((s) => s.finalVideoUrl).length;
  const allReady = segs.length > 0 && readyCount === segs.length;

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

  async function poll() {
    try {
      const r = await fetch(`/api/compose?projectId=${encodeURIComponent(project.id)}`);
      const d = await r.json().catch(() => ({}));
      if (!d.ok) return;
      setStatus(d.status ?? "");
      setProgress(d.progress ?? "");
      if (d.status === "generated" && d.finalVideoUrl) {
        setFinalUrl(d.finalVideoUrl);
        setComposing(false);
        if (timer.current) clearInterval(timer.current);
      } else if (d.status === "error") {
        setError(d.error || "합성 실패");
        setComposing(false);
        if (timer.current) clearInterval(timer.current);
      }
    } catch {
      /* 일시 오류는 다음 폴링에서 회복 */
    }
  }

  async function genEyecatch() {
    setGenBusy(true);
    setGenErr("");
    try {
      const r = await fetch("/api/longform/eyecatch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "아이캐치 생성 실패");
      setEyecatchUrl(d.url);
    } catch (e) {
      setGenErr(e instanceof Error ? e.message : "아이캐치 생성 실패");
    } finally {
      setGenBusy(false);
    }
  }

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
      if (timer.current) clearInterval(timer.current);
      timer.current = setInterval(poll, 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "합성 요청 실패");
      setComposing(false);
    }
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold tracking-tight line-clamp-1">🎞 {project.title}</h1>
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
        순서대로 이어붙이고 사이에 구독 아이캐치를 넣습니다.
      </p>

      {/* 아이캐치 — 맨 위에 눈에 띄게. 세그먼트 사이마다 들어갈 마스코트 카드. */}
      <div className="mt-4 rounded-xl border border-accent/40 bg-accent/5 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">구독 아이캐치</h2>
          <button
            onClick={genEyecatch}
            disabled={genBusy}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong text-white px-3 py-1.5 disabled:opacity-40"
          >
            {genBusy ? "생성 중…" : eyecatchUrl ? "다시 생성" : "아이캐치 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          송곳니 안경 미소녀 마스코트 + 구독 버튼(16:9). 세그먼트 사이마다 1초씩 들어갑니다. 롱폼당 1장.
        </p>
        {genErr && <p className="mt-2 text-[11px] text-red-600">{genErr}</p>}
        {eyecatchUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={eyecatchUrl}
            alt="아이캐치"
            className="mt-2 w-full max-w-xs aspect-[16/9] object-cover rounded-lg border border-zinc-200 dark:border-zinc-800"
          />
        ) : (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            아직 없음 — 합성 전에 눌러서 만들어 두세요.
          </p>
        )}
      </div>

      {/* 진행자(마스코트) */}
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">진행자</h2>
          <button
            onClick={genHostScript}
            disabled={hostBusy}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {hostBusy ? "생성 중…" : hostProject ? "대본 다시 생성" : "진행자 대본 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          안경 미소녀 + 사족로봇이 세그먼트를 소개·연결·마무리합니다. 대본 생성 뒤 <b>진행자 편집</b>에서
          세그먼트처럼 씬별로 이미지·영상·음성을 만드세요(오프닝 첫 씬 = 캐릭터 확정).
        </p>
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

      {/* 열린 고리 오프닝 */}
      <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">🎣 오프닝 (열린 고리)</h2>
          <button
            onClick={genOpening}
            disabled={openBusy}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
          >
            {openBusy ? "생성 중…" : opening ? "다시 생성" : "오프닝 생성"}
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">
          시청자가 &lsquo;아직 답을 못 들었다&rsquo;며 끝까지 보게 만드는 오프닝. 세그먼트를 챕터로 읽어 Claude가 작성.
        </p>
        {openErr && <p className="mt-2 text-[11px] text-red-600">{openErr} — 확정은 그대로 진행됩니다.</p>}
        {opening && (
          <div className="mt-2 grid gap-2">
            <div>
              <textarea
                value={openScript}
                onChange={(e) => setOpenScript(e.target.value)}
                rows={Math.max(4, openScript.split("\n").length)}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-2 text-xs leading-relaxed outline-none focus:border-accent"
              />
              <div className="mt-1 flex justify-end">
                <button
                  onClick={saveOpening}
                  disabled={openSaveBusy}
                  className="text-[11px] rounded-md bg-accent hover:bg-accent-strong text-white px-3 py-1 disabled:opacity-40"
                >
                  {openSaveBusy ? "저장 중…" : "오프닝 저장"}
                </button>
              </div>
            </div>
            <div className="rounded-lg bg-accent/5 border border-accent/30 p-2 text-[11px]">
              <p>
                <span className="font-semibold text-accent">연 질문:</span> {opening.openLoop.question}
              </p>
              <p className="mt-0.5">
                <span className="font-semibold text-accent">닫는 곳:</span> 이 질문은{" "}
                <b>{opening.openLoop.closesAt}</b>에서 닫으세요.
                {opening.openLoop.closingLineHint ? ` (힌트: ${opening.openLoop.closingLineHint})` : ""}
              </p>
              {opening.selfCheck.midpointExitCost && (
                <p className="mt-0.5 text-zinc-500">중간 이탈 손해: {opening.selfCheck.midpointExitCost}</p>
              )}
              {opening.selfCheck.roadmapLeak && (
                <p className="mt-0.5 text-red-500">⚠ 로드맵(목차) 노출 위험 — 다시 생성 권장</p>
              )}
            </div>
            {opening.chapterBridges.length > 0 && (
              <div className="text-[11px]">
                <p className="font-semibold text-zinc-600 dark:text-zinc-300">챕터 연결 가이드</p>
                <ul className="mt-0.5 grid gap-0.5">
                  {opening.chapterBridges.map((b, i) => (
                    <li key={i} className="text-zinc-500">
                      <b>C{b.chapter}</b> [{b.role}] {b.bridgeHint}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 세그먼트 현황 */}
      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">세그먼트 ({readyCount}/{segs.length} 완성)</h2>
      </div>
      <ol className="mt-2 grid gap-2">
        {segs.map((s, i) => (
          <li
            key={s.id}
            className="flex items-center gap-2 rounded-xl border border-zinc-200 dark:border-zinc-800 p-2"
          >
            {/* 순서 변경 ↑↓ */}
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
                disabled={i === segs.length - 1 || reordering}
                aria-label="아래로"
                className="leading-none text-[10px] text-zinc-500 hover:text-accent disabled:opacity-30"
              >
                ▼
              </button>
            </div>
            <span className="shrink-0 w-4 text-center text-xs font-bold text-zinc-400">{i + 1}</span>
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
          </li>
        ))}
      </ol>

      {/* 합성 */}
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
    </main>
  );
}
