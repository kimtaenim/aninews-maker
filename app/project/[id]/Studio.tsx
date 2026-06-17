"use client";

import { useState } from "react";
import { STEP_ORDER, type Project, type Scene, type StepKind } from "@/lib/types";
import type { SourceMaterial } from "@/lib/source";

const STEP_LABELS: Record<StepKind, string> = {
  source: "소스",
  script: "스크립트",
  keyframe: "키프레임",
  images: "이미지",
  videos: "영상",
  voiceover: "보이스오버",
  compose: "합성",
  subtitle: "자막",
};

export default function Studio({ project: initial }: { project: Project }) {
  const [project, setProject] = useState<Project>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const material = project.steps.source.params.material as SourceMaterial | undefined;
  const sourceApproved = project.steps.source.status === "approved";
  const scriptStatus = project.steps.script.status;

  async function approveSource() {
    setError(null);
    setBusy("approve");
    try {
      const r = await fetch("/api/step/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, step: "source" }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setProject((p) => ({
        ...p,
        steps: { ...p.steps, source: { ...p.steps.source, status: "approved" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(null);
    }
  }

  async function generateScript() {
    setError(null);
    setBusy("script");
    try {
      const r = await fetch("/api/script", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setProject((p) => ({
        ...p,
        scenes: data.scenes as Scene[],
        steps: { ...p.steps, script: { ...p.steps.script, status: "generated" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "스크립트 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="px-4 py-8 md:max-w-2xl md:mx-auto">
      <h1 className="text-lg font-semibold tracking-tight">{project.title}</h1>
      <p className="mt-1 text-xs text-zinc-500">project: {project.id}</p>

      {/* 스텝퍼 */}
      <ol className="mt-5 flex flex-wrap gap-2">
        {STEP_ORDER.map((s, i) => {
          const st = project.steps[s].status;
          const tone =
            st === "approved"
              ? "border-accent text-accent"
              : st === "generated"
                ? "border-zinc-400 text-zinc-700 dark:text-zinc-200"
                : st === "error"
                  ? "border-red-300 text-red-600"
                  : "border-zinc-200 dark:border-zinc-800 text-zinc-400";
          return (
            <li key={s} className={`text-xs rounded-full border px-3 py-1 ${tone}`}>
              {i + 1}. {STEP_LABELS[s]}
            </li>
          );
        })}
      </ol>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {/* 1단계: 소스 검수 */}
      <section className="mt-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">1. 소스</h2>
          {sourceApproved ? (
            <span className="text-xs text-accent font-medium">승인됨</span>
          ) : (
            <button
              type="button"
              onClick={approveSource}
              disabled={busy !== null}
              className="text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-50 text-white font-medium px-3 py-1.5"
            >
              {busy === "approve" ? "승인 중…" : "승인하고 다음으로"}
            </button>
          )}
        </div>
        {material && (
          <div className="mt-3 text-sm">
            <p className="font-medium">{material.title}</p>
            {material.sourceName && (
              <p className="text-xs text-zinc-500 mt-0.5">{material.sourceName}</p>
            )}
            <p className="mt-2 text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap line-clamp-6">
              {material.body}
            </p>
          </div>
        )}
      </section>

      {/* 2단계: 스크립트 */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">2. 스크립트 (씬 배열)</h2>
          <button
            type="button"
            onClick={generateScript}
            disabled={!sourceApproved || busy !== null}
            className="text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {busy === "script"
              ? "생성 중…"
              : project.scenes.length
                ? "다시 생성"
                : "스크립트 생성"}
          </button>
        </div>
        {!sourceApproved && (
          <p className="mt-2 text-xs text-zinc-500">소스를 먼저 승인해주세요.</p>
        )}
        {scriptStatus === "error" && project.steps.script.error && (
          <p className="mt-2 text-xs text-red-600">{project.steps.script.error}</p>
        )}

        {project.scenes.length > 0 && (
          <ol className="mt-4 grid gap-3">
            {project.scenes.map((sc) => (
              <li
                key={sc.index}
                className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3 text-sm"
              >
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span>씬 {sc.index + 1}</span>
                  <span>{sc.durationSec}s</span>
                </div>
                <p className="mt-1">{sc.narration}</p>
                <p className="mt-2 text-xs text-zinc-500">
                  <span className="font-medium">img:</span> {sc.imagePrompt}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  <span className="font-medium">motion:</span> {sc.motion}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
}
