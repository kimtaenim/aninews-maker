"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface SegInfo {
  id: string;
  title: string;
  keyframeUrl?: string;
  finalVideoUrl?: string;
}

// 롱폼 전용 화면 — 세그먼트(16:9로 재합성한 숏폼) 완성 현황을 보여주고,
// 전부 완성되면 "롱폼 합성"(세그먼트 완성본 + 아이캐치 이어붙이기)을 돌린다.
// 세그먼트 재생성은 각 세그먼트 프로젝트(스튜디오)에서 하고, 여기선 상태만 모아 본다.
export default function LongformStudio({
  project,
  segments,
}: {
  project: { id: string; title: string; finalVideoUrl?: string; eyecatchUrl?: string };
  segments: SegInfo[];
}) {
  const [composing, setComposing] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<string>("");
  const [finalUrl, setFinalUrl] = useState<string | undefined>(project.finalVideoUrl);
  const [error, setError] = useState<string>("");
  const [eyecatchUrl, setEyecatchUrl] = useState<string | undefined>(project.eyecatchUrl);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const readyCount = segments.filter((s) => s.finalVideoUrl).length;
  const allReady = segments.length > 0 && readyCount === segments.length;

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
        <Link
          href="/library"
          className="shrink-0 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-800 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
        >
          ← 라이브러리
        </Link>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        가로 16:9 롱폼 — 아래 세그먼트를 각각 완성한 뒤 <b>롱폼 합성</b>을 누르면 세그먼트 완성본을
        순서대로 이어붙이고 사이에 구독 아이캐치를 넣습니다.
      </p>

      {/* 세그먼트 현황 */}
      <div className="mt-5 flex items-center justify-between">
        <h2 className="text-sm font-semibold">세그먼트 ({readyCount}/{segments.length} 완성)</h2>
      </div>
      <ol className="mt-2 grid gap-2">
        {segments.map((s, i) => (
          <li
            key={s.id}
            className="flex items-center gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-2"
          >
            <span className="shrink-0 w-5 text-center text-xs font-bold text-zinc-400">{i + 1}</span>
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

      {/* 아이캐치 */}
      <div className="mt-5 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">구독 아이캐치</h2>
          <button
            onClick={genEyecatch}
            disabled={genBusy}
            className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
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
            className="mt-2 w-full aspect-[16/9] object-cover rounded-lg border border-zinc-200 dark:border-zinc-800"
          />
        ) : (
          <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400">
            미생성 — 지금 합성하면 세그먼트만 이어붙습니다.
          </p>
        )}
      </div>

      {/* 합성 */}
      <div className="mt-5 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
        <button
          onClick={startCompose}
          disabled={!allReady || composing}
          className="w-full rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium py-2"
        >
          {composing ? "합성 중…" : allReady ? "롱폼 합성" : `세그먼트 완성 대기 (${readyCount}/${segments.length})`}
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
