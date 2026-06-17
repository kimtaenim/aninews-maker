"use client";

import { useState } from "react";
import { STEP_ORDER, type Project, type Scene, type StepKind } from "@/lib/types";
import type { SourceMaterial } from "@/lib/source";
import type { StyleProfile } from "@/lib/styleProfiles";
import Spinner from "@/components/Spinner";

// 진행 중 버튼 내용 — 스피너 + 라벨
function Busy({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Spinner /> {children}
    </span>
  );
}

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

export default function Studio({
  project: initial,
  styleProfile,
}: {
  project: Project;
  styleProfile: StyleProfile | null;
}) {
  const [project, setProject] = useState<Project>(initial);
  const [busy, _setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<StepKind | null>(null);

  // 진행 중인 액션 → 어느 단계인지 매핑. 에러를 그 단계 패널에 표시하기 위함.
  function actionToStep(action: string): StepKind | null {
    const a = action.startsWith("approve-") ? action.slice(8) : action;
    if (a === "source") return "source";
    if (a === "script" || a === "save") return "script";
    if (a.startsWith("keyframe")) return "keyframe";
    if (a.startsWith("scene") || a.startsWith("images")) return "images";
    if (a.startsWith("video")) return "videos";
    if (a.startsWith("audio") || a === "voiceover") return "voiceover";
    return null;
  }
  // setBusy(action) 가 진행 단계를 errorStep 에 기록한다. setBusy(null)(finally)은
  // 지우지 않으므로(직전 단계 유지), 에러가 나면 그 단계 패널에 메시지가 남는다.
  // 성공 시엔 핸들러 시작의 setError(null) 로 error 가 비어 아무것도 안 뜬다.
  function setBusy(action: string | null) {
    _setBusy(action);
    if (action) setErrorStep(actionToStep(action));
  }

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

  // 키프레임 StepChat (대화 미세조정)
  const [chat, setChat] = useState(initial.steps.keyframe.chat);
  const [chatInput, setChatInput] = useState("");
  const imagesStatus = project.steps.images.status;
  const imagesApproved = imagesStatus === "approved";

  // 이미지 비용 라벨(₩) — keyframe + 씬별
  const [keyframeCost, setKeyframeCost] = useState<string | null>(null);
  const [sceneCost, setSceneCost] = useState<Record<number, string>>({});

  // 씬1 이후(씬0=키프레임)가 모두 이미지를 가졌는지
  const extraScenes = project.scenes.slice(1);
  const allScenesHaveImage =
    extraScenes.length > 0 && extraScenes.every((s) => !!s.imageUrl);

  const videosStatus = project.steps.videos.status;
  const videosApproved = videosStatus === "approved";
  const [videoCost, setVideoCost] = useState<Record<number, string>>({});
  const [activeVideo, setActiveVideo] = useState<number | null>(null);
  const allScenesHaveVideo =
    project.scenes.length > 0 && project.scenes.every((s) => !!s.videoUrl);

  const voiceoverStatus = project.steps.voiceover.status;
  const voiceoverApproved = voiceoverStatus === "approved";
  const [audioCost, setAudioCost] = useState<Record<number, string>>({});
  const allScenesHaveAudio =
    project.scenes.length > 0 && project.scenes.every((s) => !!s.audioUrl);

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
      setKeyframeCost((data.cost as string) ?? null);
      setProject((p) => ({
        ...p,
        keyframeUrl: data.url as string,
        scenes: p.scenes.map((s, i) =>
          i === 0 ? { ...s, imageUrl: data.url as string, status: "generated" } : s
        ),
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

  // 키프레임 StepChat: 대화로 style bible 미세조정 → 갱신. 이후 "다시 생성"으로 적용.
  async function sendKeyframeChat() {
    const msg = chatInput.trim();
    if (!msg || busy !== null) return;
    setError(null);
    setBusy("keyframe-chat");
    try {
      const data = await call("/api/stepchat", {
        projectId: project.id,
        step: "keyframe",
        userMessage: msg,
      });
      setChat(data.chat as typeof chat);
      setProject((p) => ({ ...p, styleBible: data.styleBible as string }));
      setChatInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "미세조정 실패");
    } finally {
      setBusy(null);
    }
  }

  // 씬 한 장 생성/리롤. 성공하면 project.scenes 갱신 + 비용 라벨 저장.
  // 반환: 성공 여부 (전체 생성 루프가 중단 판단에 사용)
  async function generateOneScene(sceneIndex: number): Promise<boolean> {
    const data = await call("/api/image/scene", { projectId: project.id, sceneIndex });
    setSceneCost((c) => ({ ...c, [sceneIndex]: (data.cost as string) ?? "" }));
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) =>
        i === sceneIndex
          ? { ...s, imageUrl: data.url as string, status: "generated" }
          : s
      ),
      steps: {
        ...p.steps,
        images: {
          ...p.steps.images,
          status: (data.allDone ? "generated" : "generating") as "generated" | "generating",
        },
      },
    }));
    return true;
  }

  async function generateScene(sceneIndex: number) {
    setError(null);
    setBusy(`scene-${sceneIndex}`);
    try {
      await generateOneScene(sceneIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  // 씬1 이후 이미지 없는 씬들을 순차 생성(병렬 금지 — last-write-wins 방지).
  async function generateAllScenes() {
    setError(null);
    setBusy("images-all");
    try {
      for (let i = 1; i < project.scenes.length; i++) {
        if (project.scenes[i].imageUrl) continue;
        await generateOneScene(i);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  async function approveImages() {
    setError(null);
    setBusy("approve-images");
    try {
      await call("/api/step/approve", { projectId: project.id, step: "images" });
      setProject((p) => ({
        ...p,
        steps: { ...p.steps, images: { ...p.steps.images, status: "approved" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(null);
    }
  }

  // ── 5단계: 비디오 (fal image-to-video, 비동기 제출 → 폴링) ────────────────────
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 한 씬: 제출 → 완료까지 폴링(최대 ~5분). 완료 시 project.scenes 갱신.
  async function submitAndPollVideo(sceneIndex: number): Promise<void> {
    await call("/api/video/scene", { projectId: project.id, sceneIndex });
    const MAX_TRIES = 60; // 60 × 5s = 5분
    for (let t = 0; t < MAX_TRIES; t++) {
      await sleep(5000);
      const r = await fetch(
        `/api/video/scene?projectId=${encodeURIComponent(project.id)}&sceneIndex=${sceneIndex}`
      );
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      if (data.status === "failed") throw new Error(data.error || "비디오 생성 실패");
      if (data.status === "completed") {
        setVideoCost((c) => ({ ...c, [sceneIndex]: (data.cost as string) ?? "" }));
        setProject((p) => ({
          ...p,
          scenes: p.scenes.map((s, i) =>
            i === sceneIndex
              ? { ...s, videoUrl: data.videoUrl as string, status: "generated" }
              : s
          ),
          steps: {
            ...p.steps,
            videos: {
              ...p.steps.videos,
              status: (data.allDone ? "generated" : "generating") as
                | "generated"
                | "generating",
            },
          },
        }));
        return;
      }
      // pending / running → 계속 폴링
    }
    throw new Error("비디오 생성이 시간 내 끝나지 않았어요 (잠시 후 다시 시도)");
  }

  async function generateVideo(sceneIndex: number) {
    setError(null);
    setBusy(`video-${sceneIndex}`);
    setActiveVideo(sceneIndex);
    try {
      await submitAndPollVideo(sceneIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : "비디오 생성 실패");
    } finally {
      setActiveVideo(null);
      setBusy(null);
    }
  }

  // 비디오 없는 씬들을 순차 생성(병렬 금지 — last-write-wins 방지).
  async function generateAllVideos() {
    setError(null);
    setBusy("videos-all");
    try {
      for (let i = 0; i < project.scenes.length; i++) {
        if (project.scenes[i].videoUrl) continue;
        setActiveVideo(i);
        await submitAndPollVideo(i);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "비디오 생성 실패");
    } finally {
      setActiveVideo(null);
      setBusy(null);
    }
  }

  async function approveVideos() {
    setError(null);
    setBusy("approve-videos");
    try {
      await call("/api/step/approve", { projectId: project.id, step: "videos" });
      setProject((p) => ({
        ...p,
        steps: { ...p.steps, videos: { ...p.steps.videos, status: "approved" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(null);
    }
  }

  // ── 6단계: 음성 (ElevenLabs TTS, 동기 호출) ──────────────────────────────────
  async function generateOneAudio(sceneIndex: number): Promise<void> {
    const data = await call("/api/audio/scene", { projectId: project.id, sceneIndex });
    setAudioCost((c) => ({ ...c, [sceneIndex]: (data.cost as string) ?? "" }));
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) =>
        i === sceneIndex
          ? { ...s, audioUrl: data.url as string, status: "generated" }
          : s
      ),
      steps: {
        ...p.steps,
        voiceover: {
          ...p.steps.voiceover,
          status: (data.allDone ? "generated" : "generating") as
            | "generated"
            | "generating",
        },
      },
    }));
  }

  async function generateAudio(sceneIndex: number) {
    setError(null);
    setBusy(`audio-${sceneIndex}`);
    try {
      await generateOneAudio(sceneIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : "음성 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  // 음성 없는 씬들을 순차 생성(병렬 금지 — last-write-wins 방지).
  async function generateAllAudio() {
    setError(null);
    setBusy("audio-all");
    try {
      for (let i = 0; i < project.scenes.length; i++) {
        if (project.scenes[i].audioUrl) continue;
        await generateOneAudio(i);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "음성 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  async function approveVoiceover() {
    setError(null);
    setBusy("approve-voiceover");
    try {
      await call("/api/step/approve", { projectId: project.id, step: "voiceover" });
      setProject((p) => ({
        ...p,
        steps: { ...p.steps, voiceover: { ...p.steps.voiceover, status: "approved" } },
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

      {/* 단계와 무관한 에러만 여기(상단). 단계별 에러는 각 단계 패널에 표시된다. */}
      {error && !errorStep && (
        <p className="mt-4 text-sm text-red-600">{error}</p>
      )}

      {/* 1단계: 소스 검수 */}
      <section className="mt-6 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">1. 소스</h2>
          {sourceApproved && (
            <span className="text-xs text-accent font-medium">승인됨</span>
          )}
        </div>
        {errorStep === "source" && error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}
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
        {!sourceApproved && (
          <button
            type="button"
            onClick={approveSource}
            disabled={busy !== null}
            className="mt-3 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-50 text-white font-semibold py-3 transition-colors"
          >
            {busy === "approve-source" ? (
              <Busy>승인 중…</Busy>
            ) : (
              "✓ 소스 승인하고 스크립트 단계로 →"
            )}
          </button>
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
            {busy === "script" ? <Busy>생성 중…</Busy> : hasScenes ? "AI 재생성" : "스크립트 생성"}
          </button>
        </div>
        {!sourceApproved && (
          <p className="mt-2 text-xs text-zinc-500">소스를 먼저 승인해주세요.</p>
        )}
        {scriptStatus === "error" && project.steps.script.error && (
          <p className="mt-2 text-xs text-red-600">{project.steps.script.error}</p>
        )}
        {errorStep === "script" && error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
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
                {busy === "save" ? <Busy>저장 중…</Busy> : "편집 저장"}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              길이는 4~7초로 저장 시 자동 보정됩니다. 편집 후 “편집 저장”을 눌러야
              반영됩니다.
            </p>
            {/* 승인 = 다음 단계 잠금 해제. 눈에 띄게 전체 폭으로. */}
            {!scriptApproved ? (
              <button
                type="button"
                onClick={approveScript}
                disabled={busy !== null}
                className="mt-3 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
              >
                {busy === "approve-script" ? (
                  <Busy>승인 중…</Busy>
                ) : (
                  "✓ 스크립트 승인하고 키프레임 단계로 →"
                )}
              </button>
            ) : (
              <p className="mt-3 text-xs text-accent font-medium">
                ✓ 스크립트 승인됨 — 아래 키프레임 단계로 진행하세요.
              </p>
            )}
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
              ? <Busy>생성 중…</Busy>
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
        {errorStep === "keyframe" && error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}

        {/* 스타일: 여기서 확정된다. 2D/3D 모드·팔레트·모션·포스트FX 표시 */}
        {scriptApproved && (
          <div className="mt-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-accent/15 text-accent text-xs font-bold px-2 py-0.5">
                {styleProfile?.label ?? project.styleProfileId}
              </span>
              <span className="text-[11px] text-zinc-500">스타일 (전 단계에 적용)</span>
            </div>
            <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
              {project.styleBible}
            </p>
            {styleProfile && (
              <div className="mt-2 grid gap-0.5 text-[11px] text-zinc-500">
                <p>
                  <span className="font-medium">모션:</span> {styleProfile.motionStyle}
                </p>
                {styleProfile.postFx?.frameSteppingFps != null && (
                  <p>
                    <span className="font-medium">스톱모션:</span>{" "}
                    {String(styleProfile.postFx.frameSteppingFps)}fps 프레임 스테핑
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {busy === "keyframe" && (
          <div className="mt-4 flex w-44 aspect-[9/16] items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400">
            <span className="inline-flex flex-col items-center gap-2 text-xs">
              <Spinner className="size-6" />
              이미지 생성 중…
            </span>
          </div>
        )}

        {project.keyframeUrl && busy !== "keyframe" && (
          <div className="mt-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={project.keyframeUrl}
              alt="키프레임 (씬0)"
              className="w-44 rounded-xl border border-zinc-200 dark:border-zinc-800"
            />
            {keyframeCost && (
              <p className="mt-1 text-[11px] text-zinc-400">생성 비용 {keyframeCost}</p>
            )}
            <p className="mt-2 text-[11px] text-zinc-400">
              이 한 장이 이후 모든 씬의 스타일·인물·팔레트 레퍼런스가 됩니다. 마음에
              들 때까지 다시 생성한 뒤 승인하세요.
            </p>
            {!keyframeApproved && (
              <button
                type="button"
                onClick={approveKeyframe}
                disabled={busy !== null}
                className="mt-3 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
              >
                {busy === "approve-keyframe" ? (
                  <Busy>승인 중…</Busy>
                ) : (
                  "✓ 키프레임 승인하고 이미지 단계로 →"
                )}
              </button>
            )}
          </div>
        )}

        {/* StepChat — 대화로 스타일 미세조정 */}
        {scriptApproved && (
          <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
              스타일 미세조정 (대화)
            </p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              예: “더 따뜻한 색감으로”, “인물을 더 단순하게”. 반영 후{" "}
              <span className="font-medium">‘다시 생성’</span>을 누르면 적용됩니다.
            </p>
            {chat.length > 0 && (
              <ul className="mt-2 grid gap-1.5 max-h-48 overflow-y-auto">
                {chat.map((t, i) => (
                  <li key={i} className={t.role === "user" ? "text-right" : ""}>
                    <span
                      className={
                        "inline-block rounded-lg px-2.5 py-1.5 text-xs " +
                        (t.role === "user"
                          ? "bg-accent text-white"
                          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200")
                      }
                    >
                      {t.text}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex gap-2">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendKeyframeChat();
                  }
                }}
                placeholder="스타일 수정 요청…"
                disabled={busy !== null}
                className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
              />
              <button
                type="button"
                onClick={sendKeyframeChat}
                disabled={busy !== null || !chatInput.trim()}
                className="shrink-0 rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium px-4"
              >
                {busy === "keyframe-chat" ? <Busy>…</Busy> : "보내기"}
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4단계: 씬별 이미지 (키프레임 레퍼런스) */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            4. 이미지 (씬별)
            {imagesApproved && <span className="ml-2 text-xs text-accent">승인됨</span>}
          </h2>
          <button
            type="button"
            onClick={generateAllScenes}
            disabled={!keyframeApproved || busy !== null || extraScenes.length === 0}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {busy === "images-all" ? (
              <Busy>생성 중…</Busy>
            ) : allScenesHaveImage ? (
              "빈 씬만 생성"
            ) : (
              "전체 생성"
            )}
          </button>
        </div>
        {!keyframeApproved && (
          <p className="mt-2 text-xs text-zinc-500">키프레임을 먼저 승인해주세요.</p>
        )}
        {extraScenes.length === 0 && keyframeApproved && (
          <p className="mt-2 text-xs text-zinc-500">
            추가 씬이 없어요 (씬1=키프레임 한 장).
          </p>
        )}
        {imagesStatus === "error" && project.steps.images.error && (
          <p className="mt-2 text-xs text-red-600">{project.steps.images.error}</p>
        )}
        {errorStep === "images" && error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}

        {keyframeApproved && extraScenes.length > 0 && (
          <>
            <ol className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {project.scenes.map((sc, i) => {
                if (i === 0) return null; // 씬0 = 키프레임 (3단계)
                const sceneBusy =
                  busy === `scene-${i}` || (busy === "images-all" && !sc.imageUrl);
                return (
                  <li key={i} className="grid gap-1.5">
                    <div className="flex aspect-[9/16] items-center justify-center overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                      {sceneBusy ? (
                        <span className="inline-flex flex-col items-center gap-1.5 text-[11px] text-zinc-400">
                          <Spinner className="size-5" />
                          생성 중…
                        </span>
                      ) : sc.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={sc.imageUrl}
                          alt={`씬 ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[11px] text-zinc-400">미생성</span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">씬 {i + 1}</span>
                      <button
                        type="button"
                        onClick={() => generateScene(i)}
                        disabled={busy !== null}
                        className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                      >
                        {sc.imageUrl ? "리롤" : "생성"}
                      </button>
                    </div>
                    {sceneCost[i] && (
                      <p className="text-[11px] text-zinc-400">{sceneCost[i]}</p>
                    )}
                  </li>
                );
              })}
            </ol>

            {allScenesHaveImage && !imagesApproved && (
              <button
                type="button"
                onClick={approveImages}
                disabled={busy !== null}
                className="mt-4 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
              >
                {busy === "approve-images" ? (
                  <Busy>승인 중…</Busy>
                ) : (
                  "✓ 이미지 승인하고 비디오 단계로 →"
                )}
              </button>
            )}
          </>
        )}
      </section>

      {/* 5단계: 씬별 비디오 (image-to-video) */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            5. 비디오 (씬별)
            {videosApproved && <span className="ml-2 text-xs text-accent">승인됨</span>}
          </h2>
          <button
            type="button"
            onClick={generateAllVideos}
            disabled={!imagesApproved || busy !== null || project.scenes.length === 0}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {busy === "videos-all" ? (
              <Busy>생성 중…</Busy>
            ) : allScenesHaveVideo ? (
              "빈 씬만 생성"
            ) : (
              "전체 생성"
            )}
          </button>
        </div>
        {!imagesApproved && (
          <p className="mt-2 text-xs text-zinc-500">이미지를 먼저 승인해주세요.</p>
        )}
        {videosStatus === "error" && project.steps.videos.error && (
          <p className="mt-2 text-xs text-red-600">{project.steps.videos.error}</p>
        )}
        {errorStep === "videos" && error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}

        {imagesApproved && (
          <>
            <ol className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
              {project.scenes.map((sc, i) => {
                const videoBusy = busy === `video-${i}` || activeVideo === i;
                return (
                  <li key={i} className="grid gap-1.5">
                    <div className="relative flex aspect-[9/16] items-center justify-center overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                      {sc.videoUrl ? (
                        <video
                          src={sc.videoUrl}
                          className="h-full w-full object-cover"
                          autoPlay
                          loop
                          muted
                          playsInline
                        />
                      ) : sc.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={sc.imageUrl}
                          alt={`씬 ${i + 1}`}
                          className="h-full w-full object-cover opacity-60"
                        />
                      ) : (
                        <span className="text-[11px] text-zinc-400">이미지 없음</span>
                      )}
                      {videoBusy && (
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40 text-[11px] text-white">
                          <Spinner className="size-5" />
                          생성 중…
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-zinc-500">씬 {i + 1}</span>
                      <button
                        type="button"
                        onClick={() => generateVideo(i)}
                        disabled={busy !== null || !sc.imageUrl}
                        className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                      >
                        {sc.videoUrl ? "리롤" : "비디오 생성"}
                      </button>
                    </div>
                    {videoCost[i] && (
                      <p className="text-[11px] text-zinc-400">{videoCost[i]}</p>
                    )}
                  </li>
                );
              })}
            </ol>

            {allScenesHaveVideo && !videosApproved && (
              <button
                type="button"
                onClick={approveVideos}
                disabled={busy !== null}
                className="mt-4 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
              >
                {busy === "approve-videos" ? (
                  <Busy>승인 중…</Busy>
                ) : (
                  "✓ 비디오 승인하고 음성 단계로 →"
                )}
              </button>
            )}
          </>
        )}
      </section>

      {/* 6단계: 씬별 음성 (ElevenLabs TTS) */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            6. 음성 (보이스오버)
            {voiceoverApproved && <span className="ml-2 text-xs text-accent">승인됨</span>}
          </h2>
          <button
            type="button"
            onClick={generateAllAudio}
            disabled={!videosApproved || busy !== null || project.scenes.length === 0}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {busy === "audio-all" ? (
              <Busy>생성 중…</Busy>
            ) : allScenesHaveAudio ? (
              "빈 씬만 생성"
            ) : (
              "전체 생성"
            )}
          </button>
        </div>
        {!videosApproved && (
          <p className="mt-2 text-xs text-zinc-500">비디오를 먼저 승인해주세요.</p>
        )}
        {videosApproved && !project.ttsEnabled && (
          <p className="mt-2 text-xs text-amber-600">
            이 프로젝트는 보이스오버(TTS)가 꺼진 채로 만들어졌어요. 생성은 가능하지만,
            끄려면 합성 단계에서 음성을 빼면 됩니다.
          </p>
        )}
        {voiceoverStatus === "error" && project.steps.voiceover.error && (
          <p className="mt-2 text-xs text-red-600">{project.steps.voiceover.error}</p>
        )}
        {errorStep === "voiceover" && error && (
          <p className="mt-2 text-xs text-red-600">{error}</p>
        )}

        {videosApproved && (
          <>
            <ol className="mt-4 grid gap-2">
              {project.scenes.map((sc, i) => {
                const audioBusy = busy === `audio-${i}` || busy === "audio-all";
                return (
                  <li
                    key={i}
                    className="flex items-center gap-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3"
                  >
                    <span className="shrink-0 text-[11px] text-zinc-500 w-10">씬 {i + 1}</span>
                    <div className="min-w-0 flex-1">
                      {sc.audioUrl ? (
                        <audio src={sc.audioUrl} controls className="w-full h-8" />
                      ) : audioBusy && !sc.audioUrl ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                          <Spinner className="size-4" /> 생성 중…
                        </span>
                      ) : (
                        <span className="text-[11px] text-zinc-400">미생성</span>
                      )}
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                        {sc.narration}
                      </p>
                    </div>
                    <div className="shrink-0 grid justify-items-end gap-0.5">
                      <button
                        type="button"
                        onClick={() => generateAudio(i)}
                        disabled={busy !== null || !sc.narration}
                        className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                      >
                        {sc.audioUrl ? "리롤" : "음성 생성"}
                      </button>
                      {audioCost[i] && (
                        <span className="text-[11px] text-zinc-400">{audioCost[i]}</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {allScenesHaveAudio && !voiceoverApproved && (
              <button
                type="button"
                onClick={approveVoiceover}
                disabled={busy !== null}
                className="mt-4 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
              >
                {busy === "approve-voiceover" ? (
                  <Busy>승인 중…</Busy>
                ) : (
                  "✓ 음성 승인 →"
                )}
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
