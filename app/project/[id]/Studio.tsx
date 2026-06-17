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

type EditScene = Pick<Scene, "narration" | "imagePrompt" | "motion" | "durationSec">;

function toEdit(s: Scene): EditScene {
  return {
    narration: s.narration,
    imagePrompt: s.imagePrompt,
    motion: s.motion,
    durationSec: s.durationSec,
  };
}

export default function Studio({ project: initial }: { project: Project }) {
  const [project, setProject] = useState<Project>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 편집용 씬 사본 (저장 전까지 로컬 상태)
  const [scenes, setScenes] = useState<EditScene[]>(initial.scenes.map(toEdit));
  const [dirty, setDirty] = useState(false);

  const material = project.steps.source.params.material as SourceMaterial | undefined;
  const sourceApproved = project.steps.source.status === "approved";
  const scriptStatus = project.steps.script.status;
  const scriptApproved = scriptStatus === "approved";
  const hasScenes = scenes.length > 0;
  const keyframeStatus = project.steps.keyframe.status;
  const keyframeApproved = keyframeStatus === "approved";

  function patchScene(i: number, patch: Partial<EditScene>) {
    setScenes((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setDirty(true);
  }
  function addScene() {
    setScenes((prev) => [
      ...prev,
      { narration: "", imagePrompt: "", motion: "", durationSec: 5 },
    ]);
    setDirty(true);
  }
  function deleteScene(i: number) {
    setScenes((prev) => prev.filter((_, idx) => idx !== i));
    setDirty(true);
  }
  function moveScene(i: number, dir: -1 | 1) {
    setScenes((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setDirty(true);
  }

  async function call(path: string, payload: object) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json();
    if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
    return data;
  }

  async function approveSource() {
    setError(null);
    setBusy("approve-source");
    try {
      await call("/api/step/approve", { projectId: project.id, step: "source" });
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
    if (dirty && !confirm("저장 안 한 편집 내용이 사라집니다. 새로 생성할까요?")) return;
    setError(null);
    setBusy("script");
    try {
      const data = await call("/api/script", { projectId: project.id });
      const newScenes = data.scenes as Scene[];
      setProject((p) => ({
        ...p,
        scenes: newScenes,
        steps: { ...p.steps, script: { ...p.steps.script, status: "generated" } },
      }));
      setScenes(newScenes.map(toEdit));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "스크립트 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  async function saveScenes() {
    setError(null);
    setBusy("save");
    try {
      const data = await call("/api/script/scenes", { projectId: project.id, scenes });
      const saved = data.scenes as Scene[];
      setProject((p) => ({ ...p, scenes: saved }));
      setScenes(saved.map(toEdit));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setBusy(null);
    }
  }

  async function approveScript() {
    if (dirty && !confirm("저장 안 한 편집이 있습니다. 저장하지 않고 승인할까요?")) return;
    setError(null);
    setBusy("approve-script");
    try {
      await call("/api/step/approve", { projectId: project.id, step: "script" });
      setProject((p) => ({
        ...p,
        steps: { ...p.steps, script: { ...p.steps.script, status: "approved" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(null);
    }
  }

  async function generateKeyframe() {
    setError(null);
    setBusy("keyframe");
    try {
      const data = await call("/api/image/keyframe", { projectId: project.id });
      setProject((p) => ({
        ...p,
        keyframeUrl: data.url as string,
        steps: { ...p.steps, keyframe: { ...p.steps.keyframe, status: "generated" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "키프레임 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  async function approveKeyframe() {
    setError(null);
    setBusy("approve-keyframe");
    try {
      await call("/api/step/approve", { projectId: project.id, step: "keyframe" });
      setProject((p) => ({
        ...p,
        steps: { ...p.steps, keyframe: { ...p.steps.keyframe, status: "approved" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(null);
    }
  }

  const fieldCls =
    "w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-accent";

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
              {busy === "approve-source" ? "승인 중…" : "승인하고 다음으로"}
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

      {/* 2단계: 스크립트 (편집 가능) */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            2. 스크립트 (씬 배열)
            {scriptApproved && <span className="ml-2 text-xs text-accent">승인됨</span>}
            {dirty && <span className="ml-2 text-xs text-amber-600">● 저장 안 됨</span>}
          </h2>
          <button
            type="button"
            onClick={generateScript}
            disabled={!sourceApproved || busy !== null}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {busy === "script" ? "생성 중…" : hasScenes ? "AI 재생성" : "스크립트 생성"}
          </button>
        </div>
        {!sourceApproved && (
          <p className="mt-2 text-xs text-zinc-500">소스를 먼저 승인해주세요.</p>
        )}
        {scriptStatus === "error" && project.steps.script.error && (
          <p className="mt-2 text-xs text-red-600">{project.steps.script.error}</p>
        )}

        {hasScenes && (
          <>
            <ol className="mt-4 grid gap-3">
              {scenes.map((sc, i) => (
                <li
                  key={i}
                  className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3 grid gap-2"
                >
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span className="font-medium">씬 {i + 1}</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => moveScene(i, -1)}
                        disabled={i === 0}
                        className="px-1.5 py-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
                        aria-label="위로"
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        onClick={() => moveScene(i, 1)}
                        disabled={i === scenes.length - 1}
                        className="px-1.5 py-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
                        aria-label="아래로"
                      >
                        ↓
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteScene(i)}
                        className="px-1.5 py-0.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950"
                        aria-label="삭제"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <label className="grid gap-1">
                    <span className="text-[11px] text-zinc-500">나레이션</span>
                    <textarea
                      value={sc.narration}
                      onChange={(e) => patchScene(i, { narration: e.target.value })}
                      rows={2}
                      className={fieldCls + " resize-y"}
                    />
                  </label>

                  <label className="grid gap-1">
                    <span className="text-[11px] text-zinc-500">이미지 프롬프트 (영문)</span>
                    <textarea
                      value={sc.imagePrompt}
                      onChange={(e) => patchScene(i, { imagePrompt: e.target.value })}
                      rows={2}
                      className={fieldCls + " resize-y font-mono text-xs"}
                    />
                  </label>

                  <div className="flex gap-2">
                    <label className="grid gap-1 flex-1">
                      <span className="text-[11px] text-zinc-500">모션 (영문)</span>
                      <input
                        value={sc.motion}
                        onChange={(e) => patchScene(i, { motion: e.target.value })}
                        className={fieldCls + " font-mono text-xs"}
                      />
                    </label>
                    <label className="grid gap-1 w-20">
                      <span className="text-[11px] text-zinc-500">길이(초)</span>
                      <input
                        type="number"
                        min={4}
                        max={7}
                        value={sc.durationSec}
                        onChange={(e) =>
                          patchScene(i, { durationSec: Number(e.target.value) })
                        }
                        className={fieldCls}
                      />
                    </label>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={addScene}
                disabled={busy !== null}
                className="text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
              >
                + 씬 추가
              </button>
              <button
                type="button"
                onClick={saveScenes}
                disabled={busy !== null || !dirty}
                className="text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
              >
                {busy === "save" ? "저장 중…" : "편집 저장"}
              </button>
              <div className="grow" />
              {!scriptApproved && (
                <button
                  type="button"
                  onClick={approveScript}
                  disabled={busy !== null}
                  className="text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
                >
                  {busy === "approve-script" ? "승인 중…" : "스크립트 승인 →"}
                </button>
              )}
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              길이는 4~7초로 저장 시 자동 보정됩니다. 편집 후 “편집 저장”을 눌러야
              반영됩니다.
            </p>
          </>
        )}
      </section>

      {/* 3단계: 키프레임 (씬0 스타일 확정) */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            3. 키프레임 (씬0 스타일 확정)
            {keyframeApproved && <span className="ml-2 text-xs text-accent">승인됨</span>}
          </h2>
          <button
            type="button"
            onClick={generateKeyframe}
            disabled={!scriptApproved || busy !== null}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {busy === "keyframe"
              ? "생성 중…"
              : project.keyframeUrl
                ? "다시 생성"
                : "키프레임 생성"}
          </button>
        </div>
        {!scriptApproved && (
          <p className="mt-2 text-xs text-zinc-500">스크립트를 먼저 승인해주세요.</p>
        )}
        {keyframeStatus === "error" && project.steps.keyframe.error && (
          <p className="mt-2 text-xs text-red-600">{project.steps.keyframe.error}</p>
        )}

        {project.keyframeUrl && (
          <div className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={project.keyframeUrl}
              alt="키프레임 (씬0)"
              className="w-44 rounded-xl border border-zinc-200 dark:border-zinc-800"
            />
            <p className="mt-2 text-[11px] text-zinc-400">
              이 한 장이 이후 모든 씬의 스타일·인물·팔레트 레퍼런스가 됩니다. 마음에
              들 때까지 다시 생성한 뒤 승인하세요.
            </p>
            {!keyframeApproved && (
              <button
                type="button"
                onClick={approveKeyframe}
                disabled={busy !== null}
                className="mt-3 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
              >
                {busy === "approve-keyframe" ? "승인 중…" : "키프레임 승인 →"}
              </button>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
