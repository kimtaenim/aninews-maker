"use client";

import { useState, useEffect, useRef } from "react";
import {
  STEP_ORDER,
  DEFAULT_SUBTITLE,
  type Project,
  type Scene,
  type StepKind,
  type SubtitleSettings,
} from "@/lib/types";
import type { SourceMaterial } from "@/lib/source";
import Spinner from "@/components/Spinner";
import ScenePreview from "./ScenePreview";

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
  styleProfiles,
  videoModels,
}: {
  project: Project;
  styleProfiles: { id: string; label: string }[];
  videoModels: { id: string; label: string }[];
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
    if (a.startsWith("compose")) return "compose";
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

  // 키프레임 직접 조정: 스타일/프롬프트 편집 + 후보 3장 선택
  const [editBible, setEditBible] = useState(initial.styleBible);
  const [bibleDirty, setBibleDirty] = useState(false);
  const [candidates, setCandidates] = useState<string[]>(
    (initial.steps.keyframe.params.candidates as string[]) ?? []
  );

  // 누적 비용(이 프로젝트, 리롤 포함 전부 합산)
  const [totalKrw, setTotalKrw] = useState<string | null>(null);
  async function refreshCost() {
    try {
      const r = await fetch(`/api/cost?projectId=${encodeURIComponent(initial.id)}`);
      const d = await r.json();
      if (typeof d.totalKrw === "string") setTotalKrw(d.totalKrw);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    let active = true;
    fetch(`/api/cost?projectId=${encodeURIComponent(initial.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (active && typeof d.totalKrw === "string") setTotalKrw(d.totalKrw);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [initial.id]);

  // 4단계: 선택한 씬만 일괄 생성/리롤 (선택 안 된 건 그대로)
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(new Set());
  function toggleScene(i: number) {
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  // 5단계 비디오 모델 (프로바이더 교차: fal / grok)
  const [videoModelId, setVideoModelId] = useState(
    initial.videoModelId || videoModels[0]?.id || ""
  );
  // 씬별 모션 크기 (기본 잔잔, 가끔 크게)
  const [motionScale, setMotionScale] = useState<Record<number, "subtle" | "large">>({});

  // 자막 설정 (프로젝트 일괄)
  const [sub, setSub] = useState<SubtitleSettings>(initial.subtitle ?? DEFAULT_SUBTITLE);
  const [composeLang, setComposeLang] = useState<"ko" | "en">("ko");

  // 합성 진행 여부는 "서버 상태(steps.compose.status)"가 진실. busy(로컬)와 무관하게
  // 페이지를 떠났다 와도(remount), 백그라운드 갔다 와도 이걸로 복원한다.
  const composing = project.steps.compose.status === "generating";

  // 합성 경과 시간(초) + 진행 줄(씬 N/8) + 멈춤 감지(워커 죽음 대비).
  const [composeElapsed, setComposeElapsed] = useState(0);
  const [composeProgress, setComposeProgress] = useState("");
  const [composeStaleSec, setComposeStaleSec] = useState(0);
  const composeStartRef = useRef<number | null>(null);
  const progAtRef = useRef<number>(0); // 진행 줄이 마지막으로 '바뀐' 시각
  useEffect(() => {
    if (!composing) {
      composeStartRef.current = null;
      setComposeElapsed(0);
      setComposeProgress("");
      setComposeStaleSec(0);
      progAtRef.current = 0;
      return;
    }
    if (composeStartRef.current == null) {
      composeStartRef.current = project.steps.compose.updatedAt || Date.now();
    }
    if (progAtRef.current === 0) progAtRef.current = Date.now();
    const tick = () => {
      setComposeElapsed(
        Math.max(0, Math.floor((Date.now() - (composeStartRef.current as number)) / 1000))
      );
      // 진행 줄이 마지막으로 바뀐 뒤 얼마나 지났나(앱 기준) → 워커가 죽었는지 감지.
      setComposeStaleSec(Math.floor((Date.now() - progAtRef.current) / 1000));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [composing, project.steps.compose.updatedAt]);

  // 합성 폴링 — 한 번에 하나만 돌게 ref 로 가드. 어디서 시작하든(버튼/remount/복귀)
  // 동일 함수로 수렴. 워커는 서버에서 돌고 결과는 Redis 라, 폴링은 "상태 동기화"일 뿐.
  const composePollRef = useRef(false);
  async function runComposePoll() {
    if (composePollRef.current) return;
    composePollRef.current = true;
    try {
      for (let t = 0; t < 240; t++) {
        // ~12분. 그 안에 끝나면 반영, 넘으면 폴링만 멈추고 상태는 서버에 그대로.
        const r = await fetch(`/api/compose?projectId=${encodeURIComponent(project.id)}`);
        const d = await r.json();
        if (d.updatedAt) composeStartRef.current = d.updatedAt as number;
        if (typeof d.progress === "string") {
          setComposeProgress((prev) => {
            if (d.progress !== prev) progAtRef.current = Date.now(); // 진행 = 워커 살아있음
            return d.progress;
          });
        }
        if (d.status === "generated" && d.finalVideoUrl) {
          setProject((p) => ({
            ...p,
            finalVideoUrl: d.finalVideoUrl as string,
            steps: { ...p.steps, compose: { ...p.steps.compose, status: "generated" } },
          }));
          return;
        }
        if (d.status === "error" || d.error) {
          setError(d.error || "합성 실패");
          setProject((p) => ({
            ...p,
            steps: {
              ...p.steps,
              compose: { ...p.steps.compose, status: "error", error: d.error },
            },
          }));
          return;
        }
        await new Promise((res) => setTimeout(res, 3000));
      }
    } catch {
      /* 네트워크 끊김 등은 조용히 — 다음 방문/복귀 때 다시 폴링 */
    } finally {
      composePollRef.current = false;
    }
  }

  // 진입/복원: 합성 중이면 폴링 시작. 백그라운드→복귀(visibilitychange) 때도 재개.
  useEffect(() => {
    if (composing) void runComposePoll();
    const onVisible = () => {
      if (document.visibilityState === "visible" && composing) void runComposePoll();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composing]);

  // ── 서버 상태 복원(rehydrate) — 지하철/백그라운드/네트워크 끊김에도 robust ────────
  // 모든 작업의 진실은 서버(Redis)다. 페이지를 떠났다 와도, 화면을 잠갔다 켜도,
  // 신호가 끊겼다 붙어도 — 돌아오는 순간 서버에서 최신 상태를 다시 읽어 반영한다.
  // (편집 버퍼 scenes/enScripts/sub 는 별도 state 라 덮어쓰지 않는다.)
  const syncingRef = useRef(false);
  async function syncFromServer() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    try {
      const r = await fetch(`/api/project/state?projectId=${encodeURIComponent(project.id)}`);
      if (!r.ok) return;
      const d = await r.json();
      if (d?.ok && d.project) setProject(d.project as Project);
    } catch {
      /* 오프라인 등 — 다음 기회에 */
    } finally {
      syncingRef.current = false;
    }
  }

  // 진입 / 백그라운드 복귀 / 네트워크 복귀 시 서버에서 한 번 복원.
  useEffect(() => {
    void syncFromServer();
    const onVisible = () => {
      if (document.visibilityState === "visible") void syncFromServer();
    };
    const onOnline = () => void syncFromServer();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 제출됐지만 아직 저장 전인 영상 작업을, 상태가 바뀔 때마다 자동으로 마저 폴링한다.
  // (직접 생성하든, 복원으로 알게 됐든 동일 경로. videoPollRef 로 씬당 1개만.)
  const videoPollRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    project.scenes.forEach((s, i) => {
      if (s.videoJobId && !s.videoUrl && s.status !== "error" && !videoPollRef.current.has(i)) {
        void pollVideoUntilDone(i);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.scenes]);

  // ── 다국어판(영어) ──────────────────────────────────────────────────────────
  // 영문 스크립트는 로컬에서 편집 → 저장. 더빙(audioUrlEn)은 영어 트랙으로 별도 생성.
  const [enScripts, setEnScripts] = useState<Record<number, string>>(
    Object.fromEntries(initial.scenes.map((s) => [s.index, s.narrationEn ?? ""]))
  );
  const [enDirty, setEnDirty] = useState(false);

  async function translateEn() {
    setError(null);
    setBusy("translate-en");
    try {
      const data = await call("/api/subtitle/translate", { projectId: project.id });
      const rows = (data.scenes as Array<{ index: number; narrationEn?: string }>) ?? [];
      const map = Object.fromEntries(rows.map((r) => [r.index, r.narrationEn ?? ""]));
      setEnScripts((prev) => ({ ...prev, ...map }));
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s) => ({ ...s, narrationEn: map[s.index] ?? s.narrationEn })),
      }));
      setEnDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "영문 번역 실패");
    } finally {
      setBusy(null);
    }
  }

  async function saveEnScripts() {
    setError(null);
    setBusy("save-en");
    try {
      const payload = project.scenes.map((s) => ({
        index: s.index,
        narrationEn: enScripts[s.index] ?? "",
      }));
      await call("/api/i18n/script", { projectId: project.id, scenes: payload });
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s) => ({ ...s, narrationEn: enScripts[s.index] ?? "" })),
      }));
      setEnDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "영문 스크립트 저장 실패");
    } finally {
      setBusy(null);
    }
  }

  async function generateOneAudioEn(sceneIndex: number): Promise<void> {
    const data = await call("/api/audio/scene", {
      projectId: project.id,
      sceneIndex,
      lang: "en",
    });
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) =>
        i === sceneIndex ? { ...s, audioUrlEn: data.url as string } : s
      ),
    }));
  }

  async function generateAllAudioEn() {
    // 저장 안 한 편집이 있으면 먼저 저장(더빙은 저장된 영문 기준).
    if (enDirty) await saveEnScripts();
    setError(null);
    setBusy("audio-en-all");
    try {
      for (let i = 0; i < project.scenes.length; i++) {
        if (!(enScripts[project.scenes[i].index] ?? "").trim()) continue;
        await generateOneAudioEn(i);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "영어 더빙 실패");
    } finally {
      setBusy(null);
    }
  }
  async function saveSubtitle(patch: Partial<SubtitleSettings>) {
    const next = { ...sub, ...patch };
    setSub(next);
    try {
      await call("/api/project/subtitle", { projectId: project.id, subtitle: next });
    } catch (e) {
      setError(e instanceof Error ? e.message : "자막 설정 저장 실패");
    }
  }

  // 자막 디자인 패널(폰트·굵기·크기·위치·정렬·색). 미리보기와 7단계 양쪽에서 재사용.
  function renderSubtitlePanel() {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
        {(
          [
            ["font", "폰트", [["sans", "산세리프"], ["serif", "세리프"]]],
            ["weight", "굵기", [["regular", "보통"], ["bold", "볼드"]]],
            ["size", "크기", [["small", "작게"], ["medium", "보통"], ["large", "크게"]]],
            ["position", "위치", [["bottom", "하단"], ["top", "상단"]]],
            ["align", "정렬", [["center", "가운데"], ["left", "왼쪽"]]],
            ["box", "색(배경)", [["dark", "검은 박스·흰 글씨"], ["light", "흰 박스·검은 글씨"]]],
          ] as const
        ).map(([field, label, opts]) => (
          <label key={field} className="grid gap-1">
            <span className="text-[10px] font-medium text-zinc-500">{label}</span>
            <select
              value={sub[field as keyof SubtitleSettings]}
              onChange={(e) =>
                saveSubtitle({ [field]: e.target.value } as Partial<SubtitleSettings>)
              }
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              {opts.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    );
  }

  // 7단계: 합성 — worker 에 작업 적재. 진행 추적은 서버 상태 + runComposePoll 이 담당하므로
  // 이 함수가 끝나도(페이지를 떠나도) 합성은 계속되고, 돌아오면 자동으로 이어진다.
  async function startCompose() {
    setError(null);
    setBusy("compose");
    try {
      await call("/api/compose", { projectId: project.id, lang: composeLang });
      const now = Date.now();
      composeStartRef.current = now;
      setProject((p) => ({
        ...p,
        finalVideoUrl: undefined,
        steps: {
          ...p.steps,
          compose: { ...p.steps.compose, status: "generating", error: undefined, updatedAt: now },
        },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "합성 요청 실패");
    } finally {
      setBusy(null);
    }
    // status 가 generating 으로 바뀌면 위 useEffect 가 폴링을 시작한다.
  }

  // 합성 중단 — 멈춘/매달린 합성을 취소하고 상태 리셋(스피너 해제 + 재시도 가능).
  async function cancelCompose() {
    try {
      await fetch(`/api/compose?projectId=${encodeURIComponent(project.id)}`, {
        method: "DELETE",
      });
    } catch {
      /* 무시 */
    }
    composePollRef.current = false;
    setProject((p) => ({
      ...p,
      steps: {
        ...p.steps,
        compose: { ...p.steps.compose, status: "error", error: "사용자가 중단했어요" },
      },
    }));
    setBusy(null);
  }

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
    void refreshCost(); // 생성·리롤 등 모든 액션 후 누적 비용 갱신
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
      setCandidates(data.urls as string[]);
      // 새로 3장 생성 → 기존 선택 해제(다시 고르게)
      setProject((p) => ({
        ...p,
        keyframeUrl: undefined,
        steps: { ...p.steps, keyframe: { ...p.steps.keyframe, status: "generated" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "키프레임 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  // 후보 3장 중 하나 선택 → 키프레임 확정
  async function selectKeyframe(url: string) {
    if (busy !== null) return;
    setError(null);
    setBusy("keyframe-select");
    try {
      await call("/api/image/keyframe/select", { projectId: project.id, url });
      setProject((p) => ({
        ...p,
        keyframeUrl: url,
        scenes: p.scenes.map((s, i) =>
          i === 0 ? { ...s, imageUrl: url, status: "generated" } : s
        ),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "선택 실패");
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

  // 모드(2D/3D) 변경 — style bible 을 그 모드 기본값으로 리셋.
  async function changeMode(styleProfileId: string) {
    if (styleProfileId === project.styleProfileId) return;
    setError(null);
    setBusy("keyframe-mode");
    try {
      const data = await call("/api/project/style", { projectId: project.id, styleProfileId });
      setProject((p) => ({
        ...p,
        styleProfileId: data.styleProfileId as string,
        styleBible: data.styleBible as string,
      }));
      setEditBible(data.styleBible as string);
      setBibleDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "모드 변경 실패");
    } finally {
      setBusy(null);
    }
  }

  // 스타일/팔레트/프롬프트 직접 편집 저장.
  async function saveBible() {
    setError(null);
    setBusy("keyframe-bible");
    try {
      const data = await call("/api/project/style", {
        projectId: project.id,
        styleBible: editBible,
      });
      setProject((p) => ({ ...p, styleBible: data.styleBible as string }));
      setEditBible(data.styleBible as string);
      setBibleDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "스타일 저장 실패");
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
      setEditBible(data.styleBible as string);
      setBibleDirty(false);
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

  // 선택한 씬들만 순차 생성/리롤. (병렬은 프로젝트 통째 저장이라 last-write-wins 위험)
  async function generateSelectedScenes() {
    if (selectedScenes.size === 0 || busy !== null) return;
    setError(null);
    setBusy("images-selected");
    try {
      for (const i of [...selectedScenes].sort((a, b) => a - b)) {
        if (i < 1 || i >= project.scenes.length) continue;
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

  // 제출된 한 씬의 영상을 완료까지 폴링(씬당 1개만 — videoPollRef 가드). GET 호출이
  // fal/grok 작업을 진행시키고 완료 시 Blob 저장 + 상태 갱신을 서버가 한다. 페이지를
  // 떠나도 이 함수가 죽을 뿐, 서버 작업·결과는 유지되고 복귀 시 다시 이 경로로 재개된다.
  async function pollVideoUntilDone(sceneIndex: number): Promise<void> {
    if (videoPollRef.current.has(sceneIndex)) return;
    videoPollRef.current.add(sceneIndex);
    try {
      const MAX_TRIES = 120; // 120 × 5s = 10분
      for (let t = 0; t < MAX_TRIES; t++) {
        const r = await fetch(
          `/api/video/scene?projectId=${encodeURIComponent(project.id)}&sceneIndex=${sceneIndex}`
        );
        const data = await r.json();
        if (!r.ok) {
          if (r.status === 409) return; // 제출 안 된 씬 — 폴링 대상 아님
          throw new Error(data.error || `HTTP ${r.status}`);
        }
        if (data.status === "failed") {
          setError(data.error || `씬${sceneIndex + 1} 비디오 생성 실패`);
          setProject((p) => ({
            ...p,
            scenes: p.scenes.map((s, i) => (i === sceneIndex ? { ...s, status: "error" } : s)),
          }));
          return;
        }
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
        await sleep(5000); // pending / running → 계속
      }
      // 시간 초과 — 상태는 서버에 그대로. 다음 진입/복귀 때 자동 재개.
    } catch (e) {
      setError(e instanceof Error ? e.message : "비디오 폴링 실패");
    } finally {
      videoPollRef.current.delete(sceneIndex);
    }
  }

  // 한 씬: 제출 → 완료까지 폴링. 제출 직후 로컬 상태를 generating 으로 표시.
  async function submitAndPollVideo(sceneIndex: number): Promise<void> {
    const data = await call("/api/video/scene", {
      projectId: project.id,
      sceneIndex,
      videoModelId,
      motionScale: motionScale[sceneIndex] ?? "subtle",
    });
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) =>
        i === sceneIndex
          ? { ...s, videoJobId: (data.jobId as string) ?? s.videoJobId, videoUrl: undefined, status: "generating" }
          : s
      ),
      steps: { ...p.steps, videos: { ...p.steps.videos, status: "generating" } },
    }));
    await pollVideoUntilDone(sceneIndex);
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
    <>
      <main className="px-4 py-8 pb-24 md:max-w-2xl md:mx-auto">
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

        {/* 스타일 직접 조정: 모드 선택 · 품질 파라미터 · 프롬프트(팔레트) 편집 */}
        {scriptApproved && (
          <div className="mt-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3 grid gap-3">
            <div className="flex flex-wrap gap-3">
              <label className="grid gap-1">
                <span className="text-[11px] font-medium text-zinc-500">모드</span>
                <select
                  value={project.styleProfileId}
                  onChange={(e) => changeMode(e.target.value)}
                  disabled={busy !== null}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-accent disabled:opacity-50"
                >
                  {styleProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid gap-1">
                <span className="text-[11px] font-medium text-zinc-500">품질</span>
                <span className="rounded-lg bg-zinc-100 dark:bg-zinc-800 px-2.5 py-1.5 text-sm text-zinc-500">
                  빠름·저렴 (고정)
                </span>
              </div>
            </div>

            <label className="grid gap-1">
              <span className="text-[11px] font-medium text-zinc-500">
                스타일·팔레트·프롬프트 (직접 편집 — 영문)
              </span>
              <textarea
                value={editBible}
                onChange={(e) => {
                  setEditBible(e.target.value);
                  setBibleDirty(true);
                }}
                rows={4}
                disabled={busy !== null}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-accent resize-y disabled:opacity-50"
              />
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={saveBible}
                disabled={busy !== null || !bibleDirty}
                className="text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
              >
                {busy === "keyframe-bible" ? <Busy>저장 중…</Busy> : "스타일 저장"}
              </button>
              {bibleDirty && (
                <span className="text-[11px] text-amber-600">
                  ● 저장 후 ‘다시 생성’을 눌러야 반영됩니다
                </span>
              )}
            </div>
          </div>
        )}

        {busy === "keyframe" && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="flex aspect-[9/16] items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400"
              >
                <Spinner className="size-5" />
              </div>
            ))}
          </div>
        )}

        {/* 후보 3장 — 클릭해서 선택 */}
        {candidates.length > 0 && busy !== "keyframe" && (
          <div className="mt-4">
            <p className="mb-2 text-[11px] text-zinc-500">
              마음에 드는 키프레임을 고르세요. (3장 중 1장 · 이게 이후 모든 씬의 스타일·인물·팔레트 레퍼런스)
            </p>
            <div className="grid grid-cols-3 gap-2">
              {candidates.map((u) => {
                const selected = project.keyframeUrl === u;
                return (
                  <button
                    key={u}
                    type="button"
                    onClick={() => selectKeyframe(u)}
                    disabled={busy !== null}
                    className={
                      "relative rounded-xl overflow-hidden border-2 transition-colors disabled:opacity-60 " +
                      (selected
                        ? "border-accent"
                        : "border-transparent hover:border-zinc-300 dark:hover:border-zinc-600")
                    }
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt="키프레임 후보"
                      className="w-full aspect-[9/16] object-cover"
                    />
                    {selected && (
                      <span className="absolute top-1 right-1 rounded bg-accent text-white text-[10px] font-bold px-1.5 py-0.5">
                        선택됨
                      </span>
                    )}
                    {busy === "keyframe-select" && (
                      <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <Spinner className="size-5 text-white" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {keyframeCost && (
              <p className="mt-1 text-[11px] text-zinc-400">생성 비용 {keyframeCost}</p>
            )}
            {!project.keyframeUrl && (
              <p className="mt-1 text-[11px] text-amber-600">한 장을 선택해야 승인할 수 있어요.</p>
            )}
          </div>
        )}

        {/* 선택된 씬0 — 크게 표시 (잘 보이게) */}
        {project.keyframeUrl && (
          <div className="mt-4">
            <p className="mb-1 text-[11px] font-medium text-zinc-500">
              ✓ 선택된 씬0 — 이 스타일·인물이 이후 모든 씬에 적용됩니다
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={project.keyframeUrl}
              alt="선택된 씬0 키프레임"
              className="w-48 aspect-[9/16] object-cover rounded-xl border-2 border-accent"
            />
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

        {/* 승인은 맨 아래 — 모드·품질·프롬프트·대화로 다 조정한 뒤 마지막에 */}
        {project.keyframeUrl && !keyframeApproved && (
          <button
            type="button"
            onClick={approveKeyframe}
            disabled={busy !== null}
            className="mt-4 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
          >
            {busy === "approve-keyframe" ? (
              <Busy>승인 중…</Busy>
            ) : (
              "✓ 키프레임 승인하고 이미지 단계로 →"
            )}
          </button>
        )}
        {keyframeApproved && (
          <p className="mt-4 text-xs text-accent font-medium">
            ✓ 키프레임 승인됨 — 아래 이미지 단계로 진행하세요.
          </p>
        )}
      </section>

      {/* 4단계: 씬별 이미지 (키프레임 레퍼런스) */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            4. 이미지 (씬별)
            {imagesApproved && <span className="ml-2 text-xs text-accent">승인됨</span>}
          </h2>
        </div>
        {keyframeApproved && extraScenes.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={generateSelectedScenes}
              disabled={busy !== null || selectedScenes.size === 0}
              className="text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
            >
              {busy === "images-selected" ? (
                <Busy>생성 중…</Busy>
              ) : (
                `선택 생성·리롤${selectedScenes.size ? ` (${selectedScenes.size})` : ""}`
              )}
            </button>
            <button
              type="button"
              onClick={generateAllScenes}
              disabled={busy !== null}
              className="text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "images-all" ? (
                <Busy>생성 중…</Busy>
              ) : allScenesHaveImage ? (
                "빈 씬만 생성"
              ) : (
                "전체 생성"
              )}
            </button>
            <span className="text-[11px] text-zinc-400">
              체크한 씬만 생성/리롤됩니다 (선택 안 한 건 그대로).
            </span>
          </div>
        )}
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
            {/* 씬0 키프레임 = 레퍼런스 (3단계에서 확정한 스타일·인물) */}
            {project.keyframeUrl && (
              <div className="mt-4 flex items-center gap-3 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={project.keyframeUrl}
                  alt="씬0 키프레임"
                  className="w-12 aspect-[9/16] object-cover rounded-lg border border-zinc-200 dark:border-zinc-800"
                />
                <p className="text-[11px] text-zinc-500">
                  씬0 키프레임 — 모든 씬이 이 스타일·인물·팔레트를 레퍼런스로 따릅니다.
                </p>
              </div>
            )}

            {/* 씬별: 이미지 + 스크립트(편집) + 리롤 */}
            <ol className="mt-3 grid gap-3">
              {project.scenes.map((sc, i) => {
                if (i === 0) return null; // 씬0 = 키프레임
                const sceneBusy =
                  busy === `scene-${i}` ||
                  (busy === "images-all" && !sc.imageUrl) ||
                  (busy === "images-selected" && selectedScenes.has(i));
                const ed = scenes[i];
                return (
                  <li
                    key={i}
                    className="grid grid-cols-[80px_1fr] gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-2.5"
                  >
                    <div className="flex aspect-[9/16] items-center justify-center overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900">
                      {sceneBusy ? (
                        <Spinner className="size-5" />
                      ) : sc.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={sc.imageUrl}
                          alt={`씬 ${i + 1}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-[10px] text-zinc-400">미생성</span>
                      )}
                    </div>
                    <div className="grid gap-1.5 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                          <input
                            type="checkbox"
                            checked={selectedScenes.has(i)}
                            onChange={() => toggleScene(i)}
                            disabled={busy !== null}
                            className="size-3.5 accent-[var(--color-accent)]"
                          />
                          씬 {i + 1} · {sc.durationSec}s
                        </label>
                        <button
                          type="button"
                          onClick={() => generateScene(i)}
                          disabled={busy !== null}
                          className="shrink-0 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                        >
                          {sc.imageUrl ? "리롤" : "생성"}
                        </button>
                      </div>
                      <span className="text-[10px] text-zinc-400">나레이션 (영상 대사)</span>
                      <textarea
                        value={ed?.narration ?? ""}
                        onChange={(e) => patchScene(i, { narration: e.target.value })}
                        rows={2}
                        placeholder="나레이션"
                        className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-accent resize-y"
                      />
                      <span className="text-[10px] text-zinc-400">이미지 프롬프트 (영문)</span>
                      <textarea
                        value={ed?.imagePrompt ?? ""}
                        onChange={(e) => patchScene(i, { imagePrompt: e.target.value })}
                        rows={2}
                        placeholder="이미지 프롬프트 (영문)"
                        className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 font-mono text-[11px] outline-none focus:border-accent resize-y"
                      />
                      {sceneCost[i] && (
                        <p className="text-[11px] text-zinc-400">{sceneCost[i]}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {dirty && (
              <button
                type="button"
                onClick={saveScenes}
                disabled={busy !== null}
                className="mt-3 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
              >
                {busy === "save" ? <Busy>저장 중…</Busy> : "스크립트 편집 저장"}
              </button>
            )}
            <p className="mt-1 text-[11px] text-zinc-400">
              스크립트를 고치면 <span className="font-medium">저장</span> 후{" "}
              <span className="font-medium">리롤</span>해야 새 프롬프트로 이미지가 나옵니다.
            </p>

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
        {imagesApproved && (
          <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            비디오 모델 (프로바이더 교차)
            <select
              value={videoModelId}
              onChange={(e) => setVideoModelId(e.target.value)}
              disabled={busy !== null}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-700 dark:text-zinc-200 outline-none focus:border-accent disabled:opacity-50"
            >
              {videoModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-zinc-400">
              fal 막히면 Grok으로 바꿔서 생성/리롤
            </span>
          </label>
        )}
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
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-zinc-400">움직임 크기</span>
                      <select
                        value={motionScale[i] ?? "subtle"}
                        onChange={(e) =>
                          setMotionScale((m) => ({
                            ...m,
                            [i]: e.target.value as "subtle" | "large",
                          }))
                        }
                        disabled={busy !== null}
                        className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-1.5 py-0.5 text-[10px] outline-none focus:border-accent disabled:opacity-50"
                      >
                        <option value="subtle">잔잔 (기본)</option>
                        <option value="large">크게</option>
                      </select>
                    </div>
                    <span className="text-[10px] text-zinc-400">비디오 모션 프롬프트 (영문)</span>
                    <textarea
                      value={scenes[i]?.motion ?? ""}
                      onChange={(e) => patchScene(i, { motion: e.target.value })}
                      rows={2}
                      placeholder="예: slow camera push-in, gentle wind"
                      className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 font-mono text-[11px] outline-none focus:border-accent resize-y"
                    />
                    {videoCost[i] && (
                      <p className="text-[11px] text-zinc-400">{videoCost[i]}</p>
                    )}
                  </li>
                );
              })}
            </ol>

            {dirty && (
              <button
                type="button"
                onClick={saveScenes}
                disabled={busy !== null}
                className="mt-3 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
              >
                {busy === "save" ? <Busy>저장 중…</Busy> : "프롬프트 저장"}
              </button>
            )}
            <p className="mt-1 text-[11px] text-zinc-400">
              모션 프롬프트를 고치면 <span className="font-medium">저장</span> 후{" "}
              <span className="font-medium">리롤</span>하면 그 프롬프트로 생성됩니다.
            </p>

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

      {/* 미리보기 — 영상+음성+자막 (씬별 근사 합성, 굽기 전 확인용) */}
      {project.scenes.some((s) => s.videoUrl) && (
        <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-sm font-semibold">미리보기 (영상 + 음성 + 자막)</h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            ▶ 누르면 영상이 음성에 맞춰 재생되고 자막이 얹혀 보입니다. 영상이 음성보다
            짧으면 루프로 채웁니다. 정확한 길이 정렬·자막 번인은 최종 합성(worker)에서.
          </p>

          {/* 자막 디자인 (프로젝트 일괄) — 7단계에도 동일 패널 있음 */}
          <div className="mt-3">{renderSubtitlePanel()}</div>

          <ol className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-3">
            {project.scenes.map((sc, i) =>
              sc.videoUrl ? (
                <ScenePreview
                  key={i}
                  index={i}
                  videoUrl={sc.videoUrl}
                  audioUrl={sc.audioUrl}
                  subtitle={sc.narration}
                  subtitleEn={sc.narrationEn}
                  sub={sub}
                />
              ) : null
            )}
          </ol>
        </section>
      )}

      {/* 다국어판 (영어) — 미리보기와 합성 사이. 영문 자막 + 영어 더빙 별도 트랙. */}
      {project.scenes.some((s) => s.videoUrl) && (
        <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-sm font-semibold">🌐 다국어판 (영어)</h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            한국어 영상은 그대로 두고, 영문 자막 + 영어 더빙을 따로 만듭니다. 합성 때
            한국어판/영어판 중 하나를 골라 구워요. (스페인어·일본어 등은 추후 추가)
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={translateEn}
              disabled={busy !== null}
              className="rounded-lg border border-accent text-accent px-3 py-1.5 text-xs font-medium hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "translate-en" ? <Busy>번역 중…</Busy> : "① Claude 영문 번역 생성"}
            </button>
            <button
              type="button"
              onClick={saveEnScripts}
              disabled={busy !== null || !enDirty}
              className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
            >
              {busy === "save-en" ? <Busy>저장 중…</Busy> : enDirty ? "영문 저장" : "저장됨"}
            </button>
            <button
              type="button"
              onClick={generateAllAudioEn}
              disabled={busy !== null}
              className="rounded-lg border border-accent text-accent px-3 py-1.5 text-xs font-medium hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "audio-en-all" ? <Busy>더빙 중…</Busy> : "② 영어 더빙 생성 (전체)"}
            </button>
          </div>

          {/* 영문 스크립트 편집 */}
          <div className="mt-3 grid gap-2">
            {project.scenes.map((sc, i) => (
              <label key={i} className="grid gap-1">
                <span className="text-[10px] text-zinc-500">
                  씬 {i + 1}
                  <span className="ml-1 text-zinc-400">· {sc.narration}</span>
                  <span className={`ml-2 ${sc.audioUrlEn ? "text-accent" : "text-zinc-400"}`}>
                    {sc.audioUrlEn ? "🔊 더빙됨" : "더빙 없음"}
                  </span>
                </span>
                <textarea
                  value={enScripts[sc.index] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEnScripts((prev) => ({ ...prev, [sc.index]: v }));
                    setEnDirty(true);
                  }}
                  rows={2}
                  placeholder="English narration… (①로 자동 번역 후 다듬기)"
                  className={fieldCls}
                />
              </label>
            ))}
          </div>

          {/* 다국어 미리보기 — 영어 자막 + 영어 더빙 */}
          {project.scenes.some((s) => s.audioUrlEn || s.narrationEn) && (
            <>
              <h3 className="mt-4 text-xs font-semibold text-zinc-500">다국어 미리보기</h3>
              <ol className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {project.scenes.map((sc, i) =>
                  sc.videoUrl ? (
                    <ScenePreview
                      key={i}
                      index={i}
                      videoUrl={sc.videoUrl}
                      audioUrl={sc.audioUrlEn}
                      subtitle={sc.narration}
                      subtitleEn={enScripts[sc.index] || sc.narrationEn}
                      sub={{ ...sub, lang: "en" }}
                    />
                  ) : null
                )}
              </ol>
            </>
          )}
        </section>
      )}

      {/* 7단계: 최종 합성 (worker) */}
      {project.scenes.some((s) => s.videoUrl) && (
        <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-sm font-semibold">
            7. 합성 (최종 영상)
            {project.finalVideoUrl && (
              <span className="ml-2 text-xs text-accent">완성</span>
            )}
          </h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            씬 영상 + 음성 + 자막을 worker 서버가 ffmpeg 로 굽습니다(분 단위).
          </p>

          {/* 자막 디자인 — 굽기 직전 여기서 바로 조정 (미리보기와 동일) */}
          <p className="mt-3 text-[11px] font-medium text-zinc-500">자막 디자인</p>
          <div className="mt-1.5">{renderSubtitlePanel()}</div>

          {errorStep === "compose" && error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
          {project.steps.compose.status === "error" && project.steps.compose.error && (
            <p className="mt-2 text-xs text-red-600">{project.steps.compose.error}</p>
          )}

          {/* 언어 선택 — 한국어판 / 영어판(다국어). 영어판은 영어 더빙이 있어야 함. */}
          {(() => {
            const enReady = project.scenes.some((s) => s.audioUrlEn);
            return (
              <div className="mt-3 inline-flex rounded-xl border border-zinc-200 dark:border-zinc-800 p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setComposeLang("ko")}
                  className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${composeLang === "ko" ? "bg-accent text-white" : "text-zinc-500"}`}
                >
                  한국어판
                </button>
                <button
                  type="button"
                  onClick={() => enReady && setComposeLang("en")}
                  disabled={!enReady}
                  title={enReady ? "" : "위 다국어판에서 영어 더빙을 먼저 생성하세요"}
                  className={`rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-40 ${composeLang === "en" ? "bg-accent text-white" : "text-zinc-500"}`}
                >
                  영어판
                </button>
              </div>
            );
          })()}

          {(() => {
            const n = project.scenes.filter((s) => s.videoUrl).length;
            const estMin = Math.max(1, Math.ceil((n * 35 + 30) / 60)); // 씬당 ~35초 + 마무리
            const fmt = (sec: number) =>
              `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
            if (composing) {
              // 진행 줄이 150초 넘게 안 바뀌면 워커가 죽었거나 멈춘 것(앱이 직접 감지).
              const stuck = composeStaleSec > 150;
              return (
                <div className="mt-3">
                  <p className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
                    <Spinner /> 합성 중… {composeLang === "en" ? "영어판" : "한국어판"} ·{" "}
                    <span className="tabular-nums font-medium">{fmt(composeElapsed)}</span>
                    <span className="text-zinc-400">/ 예상 ~{estMin}분</span>
                  </p>
                  {composeProgress && (
                    <p className="mt-1 text-[12px] font-medium text-accent tabular-nums">
                      {composeProgress.replace(/^\d[\d:.]*\s*/, "")}
                    </p>
                  )}
                  {stuck ? (
                    <p className="mt-1 text-[11px] text-red-600">
                      ⚠ {composeStaleSec}초째 진행이 없습니다 — 워커가 멈췄을 수 있어요. 중단하고 다시 시도하세요.
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-zinc-400">
                      이 페이지를 닫거나 다른 앱을 봐도 됩니다 — 돌아오면 자동으로 이어집니다.
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={cancelCompose}
                    className={`mt-2 rounded-lg border px-3 py-1.5 text-xs ${stuck ? "border-red-500 bg-red-50 dark:bg-red-950/30 text-red-600 font-semibold" : "border-red-400 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"}`}
                  >
                    ■ 합성 중단{stuck ? " (멈춤 감지)" : ""}
                  </button>
                </div>
              );
            }
            return (
              <>
                <p className="mt-3 text-[11px] text-zinc-400">
                  씬 {n}개 · 예상 합성 시간 <span className="font-medium text-zinc-500">~{estMin}분</span>
                  {" "}· 합성은 서버에서 처리되니 페이지를 닫아도 됩니다
                </p>
                <button
                  type="button"
                  onClick={startCompose}
                  disabled={busy !== null}
                  className="mt-2 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
                >
                  {project.finalVideoUrl ? "🎬 다시 합성" : "🎬 최종 합성하기"} (
                  {composeLang === "en" ? "영어판" : "한국어판"})
                </button>
              </>
            );
          })()}

          {project.finalVideoUrl && (
            <div className="mt-4 flex flex-col items-center">
              <video
                src={project.finalVideoUrl}
                controls
                playsInline
                className="max-h-[80vh] w-auto max-w-full rounded-xl border border-zinc-200 dark:border-zinc-800"
              />
              {/* 같은 도메인 프록시(Content-Disposition: attachment) → 폰에서도 '열기'가 아니라 저장.
                  iOS는 파일 앱(다운로드)에, 안드로이드는 다운로드 폴더에 저장된다. */}
              <a
                href={`/api/download?projectId=${encodeURIComponent(project.id)}`}
                download
                className="mt-2 inline-block text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10"
              >
                ⬇ 다운로드
              </a>
              <p className="mt-1 text-[10px] text-zinc-400">
                아이폰: 받은 뒤 파일 앱 → 다운로드. 사진 앱에 넣으려면 영상 길게 눌러 “비디오 저장”.
              </p>
            </div>
          )}
        </section>
      )}
      </main>

      {/* 누적 비용 — 항상 보이는 고정 푸터 (리롤마다 합산되는 게 바로 보이게) */}
      <div className="fixed bottom-0 inset-x-0 z-40 border-t border-zinc-200/70 dark:border-zinc-800/70 bg-white/90 dark:bg-black/80 backdrop-blur px-4 py-2.5">
        <p className="md:max-w-2xl md:mx-auto text-center text-xs text-zinc-600 dark:text-zinc-300">
          누적 비용{" "}
          <span className="font-semibold text-accent">{totalKrw ?? "₩0"}</span>
        </p>
      </div>
    </>
  );
}
