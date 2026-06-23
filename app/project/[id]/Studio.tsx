"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  STEP_ORDER,
  DEFAULT_SUBTITLE,
  type Project,
  type Scene,
  type StepKind,
  type SubtitleSettings,
  type ImageSourceMode,
  type VideoSourceMode,
} from "@/lib/types";
import { upload } from "@vercel/blob/client";
import { estimateDuration } from "@/lib/scenes";
import type { SourceMaterial } from "@/lib/source";
import { TARGET_LANGUAGES, getLang } from "@/lib/languages";
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

type EditScene = Pick<
  Scene,
  | "narration"
  | "imagePrompt"
  | "motion"
  | "durationSec"
  | "imageSource"
  | "referenceImageUrl"
  | "paletteHint"
  | "videoSource"
>;

function toEdit(s: Scene): EditScene {
  return {
    narration: s.narration,
    imagePrompt: s.imagePrompt,
    motion: s.motion,
    durationSec: s.durationSec,
    imageSource: s.imageSource ?? "generate",
    referenceImageUrl: s.referenceImageUrl,
    paletteHint: s.paletteHint,
    videoSource: s.videoSource ?? "generate",
  };
}

export default function Studio({
  project: initial,
  styleProfiles,
  videoModels,
  tts,
}: {
  project: Project;
  styleProfiles: { id: string; label: string }[];
  videoModels: { id: string; label: string }[];
  tts?: {
    default: "elevenlabs" | "typecast";
    configured: { elevenlabs: boolean; typecast: boolean };
    typecastVoices?: { fallback: boolean; perLang: Record<string, boolean> };
  };
}) {
  const [project, setProject] = useState<Project>(initial);
  const [busy, _setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<StepKind | null>(null);

  // ── 동기화 경합 가드 ─────────────────────────────────────────────────────────
  // 모바일에서 느린 네트워크 + 잦은 visibilitychange 로, 생성 중 발사된 /state GET 이
  // 생성 완료 '뒤'에 도착해 방금 만든 이미지/비디오를 지우고 status 를 generating 으로
  // 되돌리던 버그(이미지 안 보임 · "generating → approved 불가")를 막는다.
  //   - busyRef: 진행 중 액션이 있으면 서버 스냅샷이 더 낡았다고 보고 적용 안 함.
  //   - mutationSeqRef: 로컬을 갱신할 때마다 증가. /state GET 시작 시점 값을 기억했다가
  //     응답 도착 시 값이 바뀌었으면(그 사이 로컬이 더 신선해짐) 그 응답을 버린다.
  const busyRef = useRef<string | null>(null);
  const mutationSeqRef = useRef(0);
  function bumpMutation() {
    mutationSeqRef.current++;
  }

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
    busyRef.current = action;
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
  // 키프레임 생성용 참조 이미지(업로드). 있으면 그걸 살려서 후보를 만든다.
  const [keyframeRefUrl, setKeyframeRefUrl] = useState<string | undefined>(
    initial.keyframeReferenceUrl
  );
  // 업로드 진행 표시(키는 "keyframe-ref" | "ref-{i}" | "img-{i}" | "vid-{i}").
  const [uploading, setUploading] = useState<string | null>(null);
  // 썸네일 클릭 시 전체화면 확대(라이트박스). null 이면 닫힘.
  const [zoomUrl, setZoomUrl] = useState<string | null>(null);
  // 드래그앤드롭 강조 중인 업로드 칸 키("img-{i}" | "ref-{i}"). 데스크톱 전용.
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  // 파일 드롭 → 업로드. 이미지 파일만, 진행 중이면 무시.
  function handleImageDrop(
    e: React.DragEvent,
    key: string,
    upload: (file: File) => void
  ) {
    e.preventDefault();
    setDragOverKey(null);
    if (busy !== null || uploading !== null) return;
    const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"));
    if (f) upload(f);
  }

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

  const router = useRouter();
  // 다른 언어판(별도 프로젝트) 생성 상태.
  const [creatingVersion, setCreatingVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  // 합성/표시용 이 프로젝트의 언어 라벨. 원본은 한국어판, 다국어판은 그 언어판.
  const composeLangLabel = initial.lang
    ? `${getLang(initial.lang)?.label ?? initial.lang}판`
    : "한국어판";

  // ── 보이스오버 엔진(프로젝트별) — env 기본값을 덮어쓴다 ───────────────────────
  const [ttsProvider, setTtsProvider] = useState<string>(
    initial.ttsProvider ?? tts?.default ?? "elevenlabs"
  );
  async function saveTtsProvider(p: "elevenlabs" | "typecast") {
    if (p === ttsProvider) return;
    const prev = ttsProvider;
    setTtsProvider(p);
    setProject((pr) => ({ ...pr, ttsProvider: p }));
    try {
      await call("/api/project/tts", { projectId: project.id, provider: p });
    } catch (e) {
      setTtsProvider(prev); // 실패 시 롤백
      setError(e instanceof Error ? e.message : "엔진 저장 실패");
    }
  }

  // 보이스오버 속도(1.0 기본 / 1.2 빠르게) — 음성 생성 시 적용. 바꾸면 다시 생성해야 반영.
  const [voiceSpeed, setVoiceSpeed] = useState<number>(initial.voiceSpeed ?? 1.2);
  async function saveVoiceSpeed(s: number) {
    if (s === voiceSpeed) return;
    const prev = voiceSpeed;
    setVoiceSpeed(s);
    setProject((pr) => ({ ...pr, voiceSpeed: s }));
    try {
      await call("/api/project/voice-speed", { projectId: project.id, speed: s });
    } catch (e) {
      setVoiceSpeed(prev); // 실패 시 롤백
      setError(e instanceof Error ? e.message : "속도 저장 실패");
    }
  }

  // 워터마크 (최종 출력에 새김) — 텍스트 + 위치(4모서리)
  const [wmText, setWmText] = useState(initial.watermark?.text ?? "");
  const [wmPos, setWmPos] = useState<"tl" | "tr" | "bl" | "br">(
    initial.watermark?.position ?? "br"
  );
  async function saveWatermark(text: string, position: "tl" | "tr" | "bl" | "br") {
    try {
      await call("/api/project/watermark", {
        projectId: project.id,
        watermark: { text, position },
      });
      setProject((p) => ({
        ...p,
        watermark: text.trim() ? { text: text.trim(), position } : undefined,
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "워터마크 저장 실패");
    }
  }

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
      // 외부 조건(composing)에 맞춰 타이머 표시 상태를 리셋 — 의도된 동기화.
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
          bumpMutation(); // 확정된 finalVideoUrl — 낡은 /state 동기화가 못 지우게
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
  // (편집 버퍼 scenes/dubScripts/sub 는 별도 state 라 덮어쓰지 않는다.)
  const syncingRef = useRef(false);
  async function syncFromServer() {
    if (syncingRef.current) return;
    syncingRef.current = true;
    const seqAtStart = mutationSeqRef.current;
    try {
      const r = await fetch(`/api/project/state?projectId=${encodeURIComponent(project.id)}`);
      if (!r.ok) return;
      const d = await r.json();
      // 진행 중 액션이 있거나(busyRef), GET 도중 로컬이 갱신됐으면(mutationSeq 증가) 이
      // 응답은 낡은 것 — 적용하면 방금 만든 자산/상태를 덮어쓴다. 그대로 버린다.
      if (busyRef.current || mutationSeqRef.current !== seqAtStart) return;
      if (d?.ok && d.project) setProject(d.project as Project);
    } catch {
      /* 오프라인 등 — 다음 기회에 */
    } finally {
      syncingRef.current = false;
    }
  }

  // 진입 / 백그라운드 복귀 / 네트워크 복귀 시 서버에서 한 번 복원.
  useEffect(() => {
    // syncFromServer 는 비동기(fetch await 뒤 setState) — 동기 캐스케이드가 아니며,
    // 진입/복귀 시 서버 진실로 복원하는 외부 동기화다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // ── 다른 언어판 만들기 — 번역된 새 프로젝트를 생성한다(별도 라이브러리 항목) ──────
  async function createVersion(lang: string) {
    if (creatingVersion) return;
    setCreatingVersion(lang);
    setVersionError(null);
    try {
      const r = await fetch("/api/project/translate-version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, lang }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      router.push(`/project/${data.projectId}`); // 새 언어판 페이지로 이동
    } catch (e) {
      setVersionError(e instanceof Error ? e.message : "다국어판 생성 실패");
      setCreatingVersion(null);
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
            ["position", "위치", [["top", "상단"], ["two-thirds", "⅔"], ["three-quarters", "¾"], ["bottom", "하단"]]],
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
      // 자막 설정 버튼은 누를 때마다 비동기 저장(POST)이라, 누르자마자 합성하면 직전
      // 변경(예: "작게")이 아직 Redis 에 안 닿아 worker 가 이전 값으로 구울 수 있다.
      // → 현재 화면의 자막 설정을 먼저 확실히 저장한 뒤 합성 큐에 넣는다.
      await call("/api/project/subtitle", { projectId: project.id, subtitle: sub });
      await call("/api/compose", { projectId: project.id, lang: "ko" });
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
  // 씬0=키프레임 앵커라 videos 완료 판정에서 제외(이미지와 동일, 씬1 이후만).
  const allScenesHaveVideo =
    extraScenes.length > 0 && extraScenes.every((s) => !!s.videoUrl);

  const voiceoverStatus = project.steps.voiceover.status;
  const voiceoverApproved = voiceoverStatus === "approved";
  const [audioCost, setAudioCost] = useState<Record<number, string>>({});
  const allScenesHaveAudio =
    project.scenes.length > 0 && project.scenes.every((s) => !!s.audioUrl);

  // 음성(TTS) 전용 스크립트 편집 버퍼 — 자막(narration)으로 미리 채워 바로 편집 가능
  // (placeholder 만 떠서 회색 글씨를 선택·수정 못 하던 문제 해소). 비우면 자막이 그대로 쓰인다.
  // 오버라이드(실제 ttsScript)만 담는다. 비어 있으면(키 없음) 화면엔 그 씬의 현재
  // 나레이션을 보여주고 음성도 나레이션을 쓴다 → 2단계에서 나레이션 고치면 자동 동기화.
  const [ttsScripts, setTtsScripts] = useState<Record<number, string>>(
    Object.fromEntries(
      initial.scenes
        .filter((s) => (s.ttsScript ?? "").trim())
        .map((s) => [s.index, s.ttsScript as string])
    )
  );
  const [ttsDirty, setTtsDirty] = useState(false);

  // 새 씬 컴포저: 나레이션 입력 + Enter → 프롬프트·모션·길이 자동 생성.
  const [composerOpen, setComposerOpen] = useState(false);
  const [newNarration, setNewNarration] = useState("");

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
  // 나레이션만으로 새 씬 추가 — 길이는 글자수로 자동, 프롬프트·모션은 3~5단계에서.
  function addSceneFromNarration() {
    const n = newNarration.trim();
    if (!n) return;
    setScenes((prev) => [
      ...prev,
      { narration: n, imagePrompt: "", motion: "", durationSec: estimateDuration(n) },
    ]);
    setDirty(true);
    setNewNarration(""); // 다음 씬을 바로 이어 입력할 수 있게 비움(컴포저는 열린 채).
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
    bumpMutation(); // 로컬이 곧 갱신됨 → 진행 중이던 /state 동기화는 낡은 것으로 무효화
    void refreshCost(); // 생성·리롤 등 모든 액션 후 누적 비용 갱신
    return data;
  }

  // ── 업로드(참조 이미지 / 직접 이미지 / 직접 영상) ──────────────────────────────
  // Blob 클라이언트 업로드 — 브라우저가 파일을 Blob 에 직접 올린다(영상이 커도 OK).
  async function uploadFile(file: File, key: string): Promise<string> {
    setUploading(key);
    try {
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-60);
      const blob = await upload(`project/${project.id}/upload-${key}-${safe}`, file, {
        access: "public",
        handleUploadUrl: "/api/upload",
      });
      void refreshCost();
      return blob.url;
    } finally {
      setUploading(null);
    }
  }

  // 씬 소스 패치 저장(서버) → 로컬 project.scenes + 편집 버퍼 동기화.
  async function patchSceneSource(
    sceneIndex: number,
    patch: {
      imageSource?: ImageSourceMode;
      referenceImageUrl?: string | null;
      paletteHint?: string | null;
      imageUrl?: string | null;
      videoSource?: VideoSourceMode;
      videoUrl?: string | null;
    }
  ) {
    const data = await call("/api/scene/source", {
      projectId: project.id,
      sceneIndex,
      ...patch,
    });
    const saved = data.scene as Scene;
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) => (i === sceneIndex ? saved : s)),
    }));
    setScenes((prev) =>
      prev.map((s, i) =>
        i === sceneIndex
          ? {
              ...s,
              imageSource: saved.imageSource ?? "generate",
              referenceImageUrl: saved.referenceImageUrl,
              paletteHint: saved.paletteHint,
              videoSource: saved.videoSource ?? "generate",
            }
          : s
      )
    );
  }

  async function setImageMode(i: number, mode: ImageSourceMode) {
    setError(null);
    try {
      await patchSceneSource(i, { imageSource: mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "모드 변경 실패");
    }
  }
  async function uploadSceneReference(i: number, file: File) {
    setError(null);
    try {
      const url = await uploadFile(file, `ref-${i}`);
      await patchSceneSource(i, { referenceImageUrl: url, imageSource: "reference" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "참조 이미지 업로드 실패");
    }
  }
  async function uploadSceneImage(i: number, file: File) {
    setError(null);
    try {
      const url = await uploadFile(file, `img-${i}`);
      await patchSceneSource(i, { imageUrl: url, imageSource: "upload" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 업로드 실패");
    }
  }
  async function setVideoMode(i: number, mode: VideoSourceMode) {
    setError(null);
    try {
      await patchSceneSource(i, { videoSource: mode });
    } catch (e) {
      setError(e instanceof Error ? e.message : "모드 변경 실패");
    }
  }
  async function uploadSceneVideo(i: number, file: File) {
    setError(null);
    try {
      const url = await uploadFile(file, `vid-${i}`);
      await patchSceneSource(i, { videoUrl: url, videoSource: "upload" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "영상 업로드 실패");
    }
  }

  // 키프레임 생성용 참조 이미지(프로젝트 레벨).
  async function uploadKeyframeRef(file: File) {
    setError(null);
    try {
      const url = await uploadFile(file, "keyframe-ref");
      await call("/api/scene/source", { projectId: project.id, keyframeReferenceUrl: url });
      setKeyframeRefUrl(url);
      setProject((p) => ({ ...p, keyframeReferenceUrl: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "참조 이미지 업로드 실패");
    }
  }
  async function clearKeyframeRef() {
    setError(null);
    try {
      await call("/api/scene/source", { projectId: project.id, keyframeReferenceUrl: "" });
      setKeyframeRefUrl(undefined);
      setProject((p) => ({ ...p, keyframeReferenceUrl: undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "참조 이미지 제거 실패");
    }
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


  // 편집 버퍼 + 생성한 값(prompt/motion)을 합쳐 서버에 저장하고 project·버퍼 동기화.
  // 라우트가 저장한 씬을 project·편집 버퍼에 반영(단계 상태는 라우트가 보존).
  function applySavedScenes(saved: Scene[]) {
    setProject((p) => ({ ...p, scenes: saved }));
    setScenes(saved.map(toEdit));
    setDirty(false);
  }

  // ── 자동 저장 (편집저장 버튼 제거) ──────────────────────────────────────────
  // 씬 편집(2·4·5단계)·스타일(3단계)은 고칠 때마다 디바운스로 조용히 저장된다.
  // busy 를 막지 않아(타이핑 중 UI 멈춤·버퍼 덮어쓰기 방지) 작은 상태 표시만 한다.
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const savingScenesRef = useRef(false);
  const editBibleRef = useRef(editBible);
  editBibleRef.current = editBible;
  const savingBibleRef = useRef(false);
  const styleEditedRef = useRef(false); // 사용자가 스타일을 직접 고쳤는지(프롬프트 자동 재생성 트리거)

  // 씬 버퍼를 서버에 저장(무음). 저장 중이면 끝난 뒤 dirty 가 다시 트리거한다.
  async function autoSaveScenes() {
    if (savingScenesRef.current) return;
    savingScenesRef.current = true;
    const snapshot = scenes;
    setSaveState("saving");
    try {
      const r = await fetch("/api/script/scenes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, scenes: snapshot }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setProject((p) => ({ ...p, scenes: data.scenes as Scene[] }));
      bumpMutation(); // 진행 중이던 /state 동기화가 방금 저장분을 덮지 않도록
      // 저장 동안 추가 편집이 없었으면 dirty 해제(버퍼는 안 덮어써 입력 보존).
      if (scenesRef.current === snapshot) setDirty(false);
      setSaveState("saved");
    } catch {
      setSaveState("error"); // busy 안 막음 — 다음 편집/플러시 때 재시도
    } finally {
      savingScenesRef.current = false;
    }
  }
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => void autoSaveScenes(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scenes, dirty]);

  // 생성·승인 등 서버 씬을 읽는 액션 전에 호출 — 미저장 편집을 즉시 반영하고 기다린다.
  async function flushScenes() {
    if (dirty) await autoSaveScenes();
    if (bibleDirty) await autoSaveBible();
  }

  // 스타일(styleBible) 자동 저장 — 별도 라우트. busy 안 막음.
  async function autoSaveBible() {
    if (savingBibleRef.current) return;
    savingBibleRef.current = true;
    const snapshot = editBible;
    setSaveState("saving");
    try {
      const r = await fetch("/api/project/style", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, styleBible: snapshot }),
      });
      const data = await r.json();
      if (!r.ok || !data.ok) throw new Error(data.error || `HTTP ${r.status}`);
      setProject((p) => ({ ...p, styleBible: data.styleBible as string }));
      bumpMutation();
      if (editBibleRef.current === snapshot) setBibleDirty(false);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      savingBibleRef.current = false;
    }
  }
  useEffect(() => {
    if (!bibleDirty) return;
    const t = setTimeout(() => void autoSaveBible(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editBible, bibleDirty]);

  // 스타일을 직접 고치면 잠시 뒤(멈춤 감지) 키프레임 이미지 프롬프트를 새 스타일로
  // AI 자동 재생성. 승인됐고 씬0 나레이션·기존 프롬프트가 있을 때만(생성 시작 전엔 X).
  useEffect(() => {
    if (!styleEditedRef.current) return;
    const t = setTimeout(async () => {
      if (!styleEditedRef.current || busyRef.current) return;
      const s0 = scenesRef.current[0];
      if (!scriptApproved || !(s0?.narration ?? "").trim() || !(s0?.imagePrompt ?? "").trim()) {
        styleEditedRef.current = false;
        return;
      }
      styleEditedRef.current = false;
      await flushScenes(); // 새 스타일 저장 보장 후 재생성
      await genImagePrompts([0], "keyframe-prompt");
    }, 1800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editBible]);

  // 자동저장 상태 표시(작게). 편집저장 버튼 자리에 들어간다.
  function renderSaveStatus() {
    if (saveState === "saving") return <span className="text-[11px] text-zinc-400">자동 저장 중…</span>;
    if (saveState === "error") return <span className="text-[11px] text-red-600">저장 실패 — 다시 편집하면 재시도</span>;
    if (saveState === "saved") return <span className="text-[11px] text-zinc-400">자동 저장됨 ✓</span>;
    return null;
  }

  // 3·4단계: 씬별 한글 이미지 프롬프트 생성·저장. 라우트가 단계 상태를 안 건드리므로
  // 승인 후 생성해도 승인이 풀리지 않는다. indices 로 대상 씬 지정(키프레임=[0]).
  async function genImagePrompts(indices: number[], action: string) {
    const targets = indices
      .map((i) => ({ index: i, narration: (scenes[i]?.narration ?? "").trim() }))
      .filter((s) => s.narration);
    if (targets.length === 0) {
      setError("나레이션이 먼저 필요해요 (스크립트를 만들어주세요).");
      return;
    }
    setError(null);
    setBusy(action);
    try {
      const data = await call("/api/script/image-prompts", {
        projectId: project.id,
        scenes: targets,
      });
      applySavedScenes(data.scenes as Scene[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "프롬프트 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  // 5단계: 씬별 영문 모션 생성·저장(단계 상태 보존).
  async function genMotions(indices: number[], action: string) {
    const targets = indices
      .map((i) => ({ index: i, narration: (scenes[i]?.narration ?? "").trim() }))
      .filter((s) => s.narration);
    if (targets.length === 0) {
      setError("나레이션이 먼저 필요해요.");
      return;
    }
    setError(null);
    setBusy(action);
    try {
      const data = await call("/api/script/motions", {
        projectId: project.id,
        scenes: targets,
      });
      applySavedScenes(data.scenes as Scene[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "모션 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  // 5단계 진입(이미지 승인) 시, 모션이 빈 씬을 한 번 자동 생성한다. 사용자가 "모션
  // 생성" 버튼을 안 눌러도 채워지게. 이미 모션이 있으면 건드리지 않는다(리롤은 수동).
  const autoMotionRef = useRef(false);
  useEffect(() => {
    if (!imagesApproved || autoMotionRef.current || busyRef.current) return;
    const need = project.scenes
      .map((s, i) => ({ i, s }))
      .filter(({ s }) => (s.narration ?? "").trim() && !(s.motion ?? "").trim())
      .map(({ i }) => i);
    if (need.length === 0) return;
    autoMotionRef.current = true;
    void genMotions(need, "video-motion");
    // genMotions 는 매 렌더 재생성되므로 deps 에서 제외(autoMotionRef 가 1회 보장).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagesApproved, project.scenes]);

  async function approveScript() {
    setError(null);
    setBusy("approve-script");
    await flushScenes(); // 미저장 편집을 먼저 저장하고 승인
    try {
      // 텍스트 대비 짧은 씬 길이는 묻지 않고 자동 적용(confirmAdjustments) 후 승인.
      const data = await call("/api/step/approve", {
        projectId: project.id,
        step: "script",
        confirmAdjustments: true,
      });
      const savedScenes = data.scenes as Scene[] | undefined;
      setProject((p) => ({
        ...p,
        scenes: savedScenes ?? p.scenes,
        steps: { ...p.steps, script: { ...p.steps.script, status: "approved" } },
      }));
      if (savedScenes) setScenes(savedScenes.map(toEdit));
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(null);
    }
  }

  async function generateKeyframe() {
    setError(null);
    setBusy("keyframe");
    await flushScenes(); // 미저장 프롬프트·스타일 먼저 반영
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
    await flushScenes();
    try {
      await generateOneScene(sceneIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  // 배치 생성 대상이 아닌 씬: 업로드 모드(직접 넣음) / 참조본 없는 reference 모드(생성
  // 불가) / 이미지 프롬프트가 아직 없는 씬(프롬프트 생성 먼저).
  function skipInBatch(i: number): boolean {
    const s = project.scenes[i];
    return (
      s.imageSource === "upload" ||
      (s.imageSource === "reference" && !s.referenceImageUrl) ||
      !(s.imagePrompt ?? "").trim()
    );
  }

  // 여러 씬을 배치 엔드포인트로 병렬 생성(서버가 한 번만 저장 → 경합 없이 빠름).
  async function runImageBatch(targets: number[], action: string) {
    if (targets.length === 0 || busy !== null) return;
    setError(null);
    setBusy(action);
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, i) => (targets.includes(i) ? { ...s, status: "generating" } : s)),
    }));
    try {
      const data = await call("/api/image/scenes-batch", {
        projectId: project.id,
        sceneIndexes: targets,
      });
      const results = (data.results as { sceneIndex: number; url?: string; error?: string }[]) ?? [];
      const urlMap = new Map(results.filter((r) => r.url).map((r) => [r.sceneIndex, r.url as string]));
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s, i) =>
          urlMap.has(i)
            ? { ...s, imageUrl: urlMap.get(i)!, status: "generated" }
            : targets.includes(i)
              ? { ...s, status: "error" }
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
      const failed = results.filter((r) => r.error);
      if (failed.length) {
        setError(`일부 씬 생성 실패: ${failed.map((f) => `씬${f.sceneIndex + 1}`).join(", ")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "이미지 생성 실패");
    } finally {
      setBusy(null);
    }
  }

  // 씬1 이후 이미지 없는 씬들을 병렬 생성.
  // all=false: 빈 씬만. all=true: 완성본 포함 전체 다시 생성.
  async function generateAllScenes(all = false) {
    await flushScenes();
    const targets = project.scenes
      .map((_, i) => i)
      .filter((i) => i >= 1 && !skipInBatch(i) && (all || !project.scenes[i].imageUrl));
    await runImageBatch(targets, "images-all");
  }

  // 선택한 씬들만 병렬 생성/리롤.
  async function generateSelectedScenes() {
    await flushScenes();
    const targets = [...selectedScenes]
      .filter((i) => i >= 1 && i < project.scenes.length && !skipInBatch(i))
      .sort((a, b) => a - b);
    await runImageBatch(targets, "images-selected");
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
          bumpMutation(); // 폴링으로 확정된 videoUrl — 낡은 /state 동기화가 못 지우게
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

  // 한 씬 제출만(빠름). 제출 직후 로컬을 generating 으로 표시.
  async function submitVideoOnly(sceneIndex: number): Promise<void> {
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
  }

  // 한 씬: 제출 → 완료까지 폴링.
  async function submitAndPollVideo(sceneIndex: number): Promise<void> {
    await submitVideoOnly(sceneIndex);
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

  // 비디오 없는 씬들을 병렬 생성: 전부 제출(빠름) → fal 이 병렬 처리 → 동시 폴링.
  // (폴링 완료 저장은 서버가 재읽기-병합이라 동시 완료에 안전.)
  async function generateAllVideos(all = false) {
    setError(null);
    setBusy("videos-all");
    try {
      const targets = project.scenes
        .map((_, i) => i)
        .filter((i) => project.scenes[i].videoSource !== "upload" && (all || !project.scenes[i].videoUrl));
      // 1) 전부 제출(순차·빠름). 한 씬 제출이 실패해도 나머지는 계속.
      const submitted: number[] = [];
      for (const i of targets) {
        try {
          await submitVideoOnly(i);
          submitted.push(i);
        } catch (e) {
          setError(e instanceof Error ? e.message : `씬${i + 1} 제출 실패`);
        }
      }
      // 2) 제출된 씬들을 동시 폴링.
      await Promise.all(submitted.map((i) => pollVideoUntilDone(i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "비디오 생성 실패");
    } finally {
      setActiveVideo(null);
      setBusy(null);
    }
  }

  // 선택한 씬들의 비디오만 병렬 리롤: 전부 제출 → 동시 폴링. (이미 있는 것도 재생성)
  async function generateSelectedVideos() {
    const targets = [...selectedScenes]
      .filter((i) => i >= 0 && i < project.scenes.length && project.scenes[i].videoSource !== "upload")
      .sort((a, b) => a - b);
    if (targets.length === 0 || busy !== null) return;
    setError(null);
    setBusy("videos-selected");
    try {
      const submitted: number[] = [];
      for (const i of targets) {
        try {
          await submitVideoOnly(i);
          submitted.push(i);
        } catch (e) {
          setError(e instanceof Error ? e.message : `씬${i + 1} 제출 실패`);
        }
      }
      await Promise.all(submitted.map((i) => pollVideoUntilDone(i)));
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
  // 음성 전용 스크립트(ttsScript) 편집분을 서버에 저장. 음성 합성은 저장된 값을 읽으므로
  // 합성/재생성 전에 먼저 저장해야 한다(자막용 narration 은 안 건드림).
  async function saveTtsScripts() {
    setError(null);
    setBusy("save-tts");
    try {
      const payload = project.scenes.map((s) => ({
        index: s.index,
        ttsScript: ttsScripts[s.index] ?? "",
      }));
      await call("/api/script/tts", { projectId: project.id, scenes: payload });
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s) => ({
          ...s,
          ttsScript: (ttsScripts[s.index] ?? "").trim() || undefined,
        })),
      }));
      setTtsDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "음성 스크립트 저장 실패");
    } finally {
      setBusy(null);
    }
  }

  // 일시적 실패(TTS 서버 타임아웃·일시 제한 등) 자동 재시도. 영구 오류면 마지막 에러를 던진다.
  async function withRetry<T>(fn: () => Promise<T>, tries = 3, delayMs = 1200): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        if (attempt < tries) await new Promise((r) => setTimeout(r, delayMs));
      }
    }
    throw lastErr;
  }

  async function generateOneAudio(sceneIndex: number): Promise<void> {
    // 씬 하나가 일시적으로 삐끗해도 전체 생성이 멈추지 않도록 짧게 재시도.
    const data = await withRetry(() =>
      call("/api/audio/scene", { projectId: project.id, sceneIndex })
    );
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
    // 미저장 나레이션·음성대본 편집을 먼저 저장(음성은 저장된 값 기준).
    await flushScenes();
    if (ttsDirty) await saveTtsScripts();
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
  async function generateAllAudio(all = false) {
    await flushScenes();
    if (ttsDirty) await saveTtsScripts();
    setError(null);
    setBusy("audio-all");
    try {
      for (let i = 0; i < project.scenes.length; i++) {
        if (!all && project.scenes[i].audioUrl) continue;
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
                  <p className="text-[10px] text-zinc-400">
                    길이 ~{estimateDuration(sc.narration)}초 (글자수 기준 자동). 이미지
                    프롬프트·모션은 3~5단계에서 생성합니다.
                    <br />
                    <span className="text-zinc-500">⏎ 자막을 끊고 싶은 곳에서 줄바꿈(Enter)</span>{" "}
                    하면 그 자리에서 자막이 나뉩니다(음성엔 영향 없음).
                  </p>
                </li>
              ))}
            </ol>

            {/* 새 씬 컴포저 — 나레이션만 입력하면 프롬프트·모션·길이를 AI가 채운다. */}
            {composerOpen && (
              <div className="mt-3 rounded-xl border border-dashed border-accent/60 p-3 grid gap-2">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                  새 씬 — 나레이션 입력 후 Enter (길이는 자동, 프롬프트·모션은 3~5단계에서)
                </span>
                <textarea
                  value={newNarration}
                  onChange={(e) => setNewNarration(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      addSceneFromNarration();
                    }
                  }}
                  rows={2}
                  autoFocus
                  placeholder="예: 정부가 새 정책을 발표했다.  (Enter=추가, Shift+Enter=줄바꿈)"
                  className={fieldCls + " resize-y"}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={addSceneFromNarration}
                    disabled={!newNarration.trim()}
                    className="text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
                  >
                    추가
                  </button>
                  <span className="text-[10px] text-zinc-400">
                    나레이션만 다듬으세요. 프롬프트·모션은 다음 단계에서 생성합니다.
                  </span>
                </div>
              </div>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setComposerOpen((v) => !v)}
                disabled={busy !== null}
                className="text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
              >
                {composerOpen ? "− 닫기" : "+ 씬 추가"}
              </button>
              <button
                type="button"
                onClick={addScene}
                disabled={busy !== null}
                className="text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
              >
                빈 씬
              </button>
              <span className="ml-1 self-center">{renderSaveStatus()}</span>
            </div>
            <p className="mt-2 text-[11px] text-zinc-400">
              고치면 자동 저장됩니다(따로 저장 안 눌러도 됨). 길이는 4~7초로 자동 보정됩니다.
            </p>
            {/* 승인 = 다음 단계 잠금 해제. 눈에 띄게 전체 폭으로. */}
            {!scriptApproved ? (
              <button
                type="button"
                onClick={() => approveScript()}
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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => genImagePrompts([0], "keyframe-prompt")}
              disabled={!scriptApproved || busy !== null || !(scenes[0]?.narration ?? "").trim()}
              className="shrink-0 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "keyframe-prompt" ? <Busy>생성 중…</Busy> : "프롬프트 생성"}
            </button>
            <button
              type="button"
              onClick={generateKeyframe}
              disabled={!scriptApproved || busy !== null || !(scenes[0]?.imagePrompt ?? "").trim()}
              className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
            >
              {busy === "keyframe"
                ? <Busy>생성 중…</Busy>
                : project.keyframeUrl
                  ? "다시 생성"
                  : "키프레임 생성"}
            </button>
          </div>
        </div>
        {(scenes[0]?.narration ?? "").trim() && (
          <p className="mt-2 text-sm font-bold leading-snug">
            <span className="text-zinc-400 font-medium">씬 1 · </span>
            {scenes[0]?.narration}
          </p>
        )}
        {!scriptApproved && (
          <p className="mt-2 text-xs text-zinc-500">스크립트를 먼저 승인해주세요.</p>
        )}
        {scriptApproved && !(scenes[0]?.imagePrompt ?? "").trim() && (
          <p className="mt-2 text-xs text-amber-600">
            모드를 정한 뒤 <span className="font-medium">"프롬프트 생성"</span>을 먼저 눌러
            씬0 이미지 프롬프트(한글)를 만들어주세요.
          </p>
        )}
        {scriptApproved && (scenes[0]?.imagePrompt ?? "").trim() && (
          <label className="mt-3 grid gap-1">
            <span className="text-[11px] text-zinc-500">씬0 이미지 프롬프트 (한글)</span>
            <textarea
              value={scenes[0]?.imagePrompt ?? ""}
              onChange={(e) => patchScene(0, { imagePrompt: e.target.value })}
              rows={7}
              className={fieldCls + " resize-y min-h-[8rem]"}
            />
          </label>
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

            {/* 키프레임 참조 이미지(선택) — 있으면 이 인물/구도를 살려서 후보 생성 */}
            <div className="grid gap-1.5">
              <span className="text-[11px] font-medium text-zinc-500">
                참조 이미지 (선택) — 이 인물·구도를 살려서 키프레임을 만듭니다
              </span>
              {keyframeRefUrl ? (
                <div className="flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={keyframeRefUrl}
                    alt="키프레임 참조"
                    className="w-12 aspect-[9/16] object-cover rounded-lg border border-zinc-200 dark:border-zinc-800"
                  />
                  <button
                    type="button"
                    onClick={clearKeyframeRef}
                    disabled={busy !== null || uploading !== null}
                    className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                  >
                    참조 제거
                  </button>
                </div>
              ) : (
                <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                  {uploading === "keyframe-ref" ? <Busy>업로드 중…</Busy> : "이미지 업로드"}
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    disabled={busy !== null || uploading !== null}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadKeyframeRef(f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
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
                  styleEditedRef.current = true; // 스타일 멈추면 키프레임 프롬프트 자동 재생성
                }}
                rows={4}
                disabled={busy !== null}
                className="w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-xs outline-none focus:border-accent resize-y disabled:opacity-50"
              />
            </label>
            <div className="flex items-center gap-2">
              {renderSaveStatus()}
              <span className="text-[11px] text-amber-600">
                고치면 자동 저장 + 키프레임 프롬프트 자동 재생성 — ‘다시 생성’으로 이미지 반영
              </span>
            </div>
          </div>
        )}

        {/* StepChat — 대화로 스타일 미세조정 (생성 이미지보다 위에 둬서 조정→생성 흐름) */}
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
              onClick={() =>
                genImagePrompts(
                  scenes.map((_, i) => i).filter((i) => i >= 1),
                  "scene-prompts"
                )
              }
              disabled={busy !== null}
              className="text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "scene-prompts" ? <Busy>생성 중…</Busy> : "전체 프롬프트 생성"}
            </button>
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
              onClick={() => generateAllScenes(false)}
              disabled={busy !== null}
              className="text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "images-all" ? <Busy>생성 중…</Busy> : "빈 씬만 생성"}
            </button>
            <button
              type="button"
              onClick={() => generateAllScenes(true)}
              disabled={busy !== null}
              className="text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              전체 생성
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
                  onClick={() => setZoomUrl(project.keyframeUrl!)}
                  className="w-12 aspect-[9/16] object-cover rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-zoom-in"
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
                const ed = scenes[i];
                const imgMode = ed?.imageSource ?? "generate";
                const imgUploading = uploading === `img-${i}`;
                const sceneBusy =
                  imgUploading ||
                  busy === `scene-${i}` ||
                  (busy === "images-all" && !sc.imageUrl && !skipInBatch(i)) ||
                  (busy === "images-selected" && selectedScenes.has(i) && !skipInBatch(i));
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
                          onClick={() => setZoomUrl(sc.imageUrl!)}
                          className="h-full w-full object-cover cursor-zoom-in"
                        />
                      ) : (
                        <span className="text-[10px] text-zinc-400">
                          {imgMode === "upload" ? "업로드 대기" : "미생성"}
                        </span>
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
                        {imgMode !== "upload" && (
                          <button
                            type="button"
                            onClick={() => generateScene(i)}
                            disabled={
                              busy !== null ||
                              uploading !== null ||
                              (imgMode === "reference" && !ed?.referenceImageUrl) ||
                              !(ed?.imagePrompt ?? "").trim()
                            }
                            title={
                              !(ed?.imagePrompt ?? "").trim()
                                ? "이미지 프롬프트가 없어요 — '전체 프롬프트 생성'을 먼저 누르세요"
                                : ""
                            }
                            className="shrink-0 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                          >
                            {sc.imageUrl ? "리롤" : "생성"}
                          </button>
                        )}
                      </div>

                      {/* 소스 모드: 프롬프트 생성 / 참조+프롬프트 / 직접 업로드 */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-zinc-400">소스</span>
                        <select
                          value={imgMode}
                          onChange={(e) => setImageMode(i, e.target.value as ImageSourceMode)}
                          disabled={busy !== null || uploading !== null}
                          className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-1.5 py-0.5 text-[10px] outline-none focus:border-accent disabled:opacity-50"
                        >
                          <option value="generate">프롬프트 생성</option>
                          <option value="reference">참조+프롬프트</option>
                          <option value="upload">직접 업로드</option>
                        </select>
                      </div>

                      <span className="text-[10px] text-zinc-400">나레이션 (영상 대사)</span>
                      <textarea
                        value={ed?.narration ?? ""}
                        onChange={(e) => patchScene(i, { narration: e.target.value })}
                        rows={2}
                        placeholder="나레이션"
                        className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-accent resize-y"
                      />

                      {imgMode === "upload" ? (
                        // 직접 업로드: 가져온 이미지를 그대로 사용
                        <label
                          onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverKey(`img-${i}`);
                          }}
                          onDragLeave={() => setDragOverKey(null)}
                          onDrop={(e) =>
                            handleImageDrop(e, `img-${i}`, (f) => uploadSceneImage(i, f))
                          }
                          className={
                            "inline-flex w-fit cursor-pointer items-center gap-1.5 text-[11px] rounded-md border px-2.5 py-1 transition-colors " +
                            (dragOverKey === `img-${i}`
                              ? "border-accent bg-accent/10"
                              : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900")
                          }
                        >
                          {imgUploading ? (
                            <Busy>업로드 중…</Busy>
                          ) : sc.imageUrl ? (
                            "이미지 교체"
                          ) : (
                            "이미지 업로드"
                          )}
                          <span className="hidden sm:inline text-zinc-400">· 드래그</span>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            disabled={busy !== null || uploading !== null}
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) uploadSceneImage(i, f);
                              e.target.value = "";
                            }}
                          />
                        </label>
                      ) : (
                        <>
                          {imgMode === "reference" && (
                            // 참조 이미지: 키프레임과 함께 레퍼런스로 넣어 인물을 살림
                            <div className="flex items-center gap-2">
                              {ed?.referenceImageUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={ed.referenceImageUrl}
                                  alt="참조"
                                  onClick={() => setZoomUrl(ed.referenceImageUrl!)}
                                  className="w-8 aspect-[9/16] object-cover rounded border border-zinc-200 dark:border-zinc-800 cursor-zoom-in"
                                />
                              )}
                              <label
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setDragOverKey(`ref-${i}`);
                                }}
                                onDragLeave={() => setDragOverKey(null)}
                                onDrop={(e) =>
                                  handleImageDrop(e, `ref-${i}`, (f) =>
                                    uploadSceneReference(i, f)
                                  )
                                }
                                className={
                                  "inline-flex w-fit cursor-pointer items-center gap-1.5 text-[11px] rounded-md border px-2.5 py-1 transition-colors " +
                                  (dragOverKey === `ref-${i}`
                                    ? "border-accent bg-accent/10"
                                    : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900")
                                }
                              >
                                {uploading === `ref-${i}` ? (
                                  <Busy>업로드 중…</Busy>
                                ) : ed?.referenceImageUrl ? (
                                  "참조 교체"
                                ) : (
                                  "참조 업로드"
                                )}
                                <span className="hidden sm:inline text-zinc-400">
                                  · 드래그
                                </span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  disabled={busy !== null || uploading !== null}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) uploadSceneReference(i, f);
                                    e.target.value = "";
                                  }}
                                />
                              </label>
                            </div>
                          )}
                          <span className="text-[10px] text-zinc-400">이미지 프롬프트 (한글)</span>
                          <textarea
                            value={ed?.imagePrompt ?? ""}
                            onChange={(e) => patchScene(i, { imagePrompt: e.target.value })}
                            rows={2}
                            placeholder="'전체 프롬프트 생성'으로 만들거나 직접 입력 (한글)"
                            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-accent resize-y"
                          />
                          <input
                            value={ed?.paletteHint ?? ""}
                            onChange={(e) => patchScene(i, { paletteHint: e.target.value })}
                            placeholder="팔레트 변주 (선택): warm sunset, cool night…"
                            className="w-full rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-accent"
                          />
                        </>
                      )}
                      {sceneCost[i] && (
                        <p className="text-[11px] text-zinc-400">{sceneCost[i]}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            <div className="mt-3">{renderSaveStatus()}</div>
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
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() =>
                genMotions(scenes.map((_, i) => i), "video-motion")
              }
              disabled={!imagesApproved || busy !== null || project.scenes.length === 0}
              className="shrink-0 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "video-motion" ? <Busy>생성 중…</Busy> : "모션 생성"}
            </button>
            <button
              type="button"
              onClick={generateSelectedVideos}
              disabled={!imagesApproved || busy !== null || selectedScenes.size === 0}
              className="shrink-0 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              {busy === "videos-selected" ? (
                <Busy>생성 중…</Busy>
              ) : (
                `선택 리롤${selectedScenes.size ? ` (${selectedScenes.size})` : ""}`
              )}
            </button>
            <button
              type="button"
              onClick={() => generateAllVideos(false)}
              disabled={!imagesApproved || busy !== null || project.scenes.length === 0}
              className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
            >
              {busy === "videos-all" ? <Busy>생성 중…</Busy> : "빈 씬만 생성"}
            </button>
            <button
              type="button"
              onClick={() => generateAllVideos(true)}
              disabled={!imagesApproved || busy !== null || project.scenes.length === 0}
              className="shrink-0 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
            >
              전체 생성
            </button>
          </div>
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
                const vidMode = scenes[i]?.videoSource ?? "generate";
                const vidUploading = uploading === `vid-${i}`;
                const videoBusy =
                  vidUploading ||
                  busy === `video-${i}` ||
                  activeVideo === i ||
                  (sc.status === "generating" && !sc.videoUrl); // 병렬(전체/선택) 생성 중
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
                        <span className="text-[11px] text-zinc-400">
                          {vidMode === "upload" ? "영상 업로드 대기" : "이미지 없음"}
                        </span>
                      )}
                      {videoBusy && (
                        <span className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/40 text-[11px] text-white">
                          <Spinner className="size-5" />
                          {vidUploading ? "업로드 중…" : "생성 중…"}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-1.5">
                      <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                        <input
                          type="checkbox"
                          checked={selectedScenes.has(i)}
                          onChange={() => toggleScene(i)}
                          disabled={busy !== null}
                          className="size-3.5 accent-[var(--color-accent)]"
                        />
                        씬 {i + 1}
                      </label>
                      <select
                        value={vidMode}
                        onChange={(e) => setVideoMode(i, e.target.value as VideoSourceMode)}
                        disabled={busy !== null || uploading !== null}
                        className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-1.5 py-0.5 text-[10px] outline-none focus:border-accent disabled:opacity-50"
                      >
                        <option value="generate">생성</option>
                        <option value="upload">직접 업로드</option>
                      </select>
                    </div>

                    {vidMode === "upload" ? (
                      // 직접 업로드: 찍어온 영상을 그대로 사용
                      <label className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                        {vidUploading ? (
                          <Busy>업로드 중…</Busy>
                        ) : sc.videoUrl ? (
                          "영상 교체"
                        ) : (
                          "영상 업로드"
                        )}
                        <input
                          type="file"
                          accept="video/*"
                          className="hidden"
                          disabled={busy !== null || uploading !== null}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadSceneVideo(i, f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => generateVideo(i)}
                          disabled={busy !== null || uploading !== null || !sc.imageUrl}
                          className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                        >
                          {sc.videoUrl ? "리롤" : "비디오 생성"}
                        </button>
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
                      </>
                    )}
                    {videoCost[i] && (
                      <p className="text-[11px] text-zinc-400">{videoCost[i]}</p>
                    )}
                  </li>
                );
              })}
            </ol>

            <div className="mt-3">{renderSaveStatus()}</div>
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

      {/* 6단계: 씬별 음성 (TTS 엔진은 아래 셀렉터로 프로젝트별 선택) */}
      <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">
            6. 음성 (보이스오버)
            {voiceoverApproved && <span className="ml-2 text-xs text-accent">승인됨</span>}
          </h2>
          <button
            type="button"
            onClick={() => generateAllAudio(false)}
            disabled={!keyframeApproved || busy !== null || project.scenes.length === 0}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {busy === "audio-all" ? <Busy>생성 중…</Busy> : "빈 씬만 생성"}
          </button>
          <button
            type="button"
            onClick={() => generateAllAudio(true)}
            disabled={!keyframeApproved || busy !== null || project.scenes.length === 0}
            className="shrink-0 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
          >
            전체 생성
          </button>
        </div>

        {/* TTS 엔진 선택(프로젝트별) — 한국어판·다국어 더빙 모두 이 엔진으로 나간다. */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-zinc-500">엔진</span>
          <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-800 p-0.5 text-xs">
            {([
              { id: "elevenlabs", label: "일레븐랩스" },
              { id: "typecast", label: "타입캐스트" },
            ] as const).map((opt) => {
              const configured = tts?.configured?.[opt.id] ?? true;
              const active = ttsProvider === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => configured && saveTtsProvider(opt.id)}
                  disabled={!configured || busy !== null}
                  title={configured ? "" : `${opt.label} API 키가 .env 에 없어요`}
                  className={`rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-40 ${active ? "bg-accent text-white" : "text-zinc-500"}`}
                >
                  {opt.label}
                  {!configured && <span className="ml-1 text-[10px]">(키 없음)</span>}
                </button>
              );
            })}
          </div>
          {!initial.ttsProvider && tts?.default && (
            <span className="text-[10px] text-zinc-400">기본값(env): {tts.default === "typecast" ? "타입캐스트" : "일레븐랩스"}</span>
          )}
        </div>

        {/* 음성 속도 — 생성 시 적용. 바꾼 뒤엔 음성을 다시 생성해야 반영된다. */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-zinc-500">속도</span>
          <div className="inline-flex rounded-xl border border-zinc-200 dark:border-zinc-800 p-0.5 text-xs">
            {([
              { v: 1.0, label: "보통" },
              { v: 1.2, label: "빠르게 1.2배" },
            ] as const).map((opt) => {
              const active = voiceSpeed === opt.v;
              return (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => saveVoiceSpeed(opt.v)}
                  disabled={busy !== null}
                  className={`rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-40 ${active ? "bg-accent text-white" : "text-zinc-500"}`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] text-zinc-400">바꾸면 음성을 다시 생성하세요</span>
        </div>

        {!keyframeApproved && (
          <p className="mt-2 text-xs text-zinc-500">
            키프레임(3단계)을 먼저 승인해주세요. 음성은 영상(5단계)을 기다리지 않고 미리
            만들 수 있어요.
          </p>
        )}
        {keyframeApproved && !project.ttsEnabled && (
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

        {keyframeApproved && (
          <>
            <ol className="mt-4 grid gap-2">
              {project.scenes.map((sc, i) => {
                const audioBusy = busy === `audio-${i}` || busy === "audio-all";
                return (
                  <li
                    key={i}
                    className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3"
                  >
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 text-[11px] text-zinc-500 w-10">씬 {i + 1}</span>
                      <p className="min-w-0 flex-1 truncate text-[11px] text-zinc-500">
                        <span className="text-zinc-400">📝 자막 </span>
                        {sc.narration}
                      </p>
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
                    </div>
                    {/* 오디오 바는 카드 전체 폭을 차지하는 별도 줄 — 좁은 칼럼에서
                        네이티브 컨트롤 최소폭이 삐져나오던 문제 방지 */}
                    {sc.audioUrl ? (
                      <audio
                        src={sc.audioUrl}
                        controls
                        className="mt-2 block w-full max-w-full h-8"
                      />
                    ) : audioBusy && !sc.audioUrl ? (
                      <span className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <Spinner className="size-4" /> 생성 중…
                      </span>
                    ) : (
                      <span className="mt-2 block text-[11px] text-zinc-400">미생성</span>
                    )}
                    {/* 음성 대본 = 귀로 듣는 말. 위 📝 자막(화면 글자)과 구분. 비우면 자막대로 읽음. */}
                    <span className="mt-2 block text-[11px] font-medium text-zinc-500">
                      🔊 음성 대본{" "}
                      <span className="font-normal text-zinc-400">
                        — 귀로 듣는 말. 비워두면 위 📝 자막을 그대로 읽어요. 발음·표현만 다르게
                        할 때만 고치세요.
                      </span>
                    </span>
                    <textarea
                      value={ttsScripts[sc.index] ?? sc.narration}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTtsScripts((prev) => {
                          const next = { ...prev };
                          // 자막과 같거나 비우면 오버라이드 해제 → 나레이션을 따라가게.
                          if (!v.trim() || v === sc.narration) delete next[sc.index];
                          else next[sc.index] = v;
                          return next;
                        });
                        setTtsDirty(true);
                      }}
                      onBlur={() => {
                        const buf = (ttsScripts[sc.index] ?? "").trim();
                        const saved = (sc.ttsScript ?? "").trim();
                        if (buf !== saved) saveTtsScripts();
                      }}
                      rows={2}
                      placeholder={sc.narration}
                      className={`${fieldCls} mt-1`}
                    />
                    <p className="mt-1 text-[10px] text-zinc-400">
                      {(ttsScripts[sc.index] ?? "").trim()
                        ? "🔊 이 대본으로 음성이 만들어집니다 (📝 자막은 위 그대로 유지)."
                        : "📝 자막을 그대로 읽습니다 — 다르게 발음·표현하려면 고치세요."}
                    </p>
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

      {/* 다른 언어판 만들기 — 번역한 새 프로젝트(별도 라이브러리 항목)를 만든다. */}
      {!project.lang && hasScenes && (
        <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-sm font-semibold">🌐 다른 언어판 만들기</h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            고른 언어로 나레이션을 번역한 <span className="font-medium">새 프로젝트</span>를
            만듭니다. 이미지 프롬프트·모션·스타일은 가져오고, 영상·음성은 새 프로젝트에서
            따로 생성해요(라이브러리에 별도 저장).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {TARGET_LANGUAGES.map((L) => (
              <button
                key={L.code}
                type="button"
                onClick={() => createVersion(L.code)}
                disabled={creatingVersion !== null}
                className="rounded-xl border border-accent text-accent px-4 py-2 text-sm font-medium hover:bg-accent/10 disabled:opacity-40"
              >
                {creatingVersion === L.code ? <Busy>만드는 중…</Busy> : L.label}
              </button>
            ))}
          </div>
          {versionError && <p className="mt-2 text-xs text-red-600">{versionError}</p>}
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

          {/* 워터마크 — 최종 영상 모서리에 새김. 비우면 안 들어감. */}
          <p className="mt-3 text-[11px] font-medium text-zinc-500">워터마크 (선택)</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={wmText}
              onChange={(e) => setWmText(e.target.value)}
              onBlur={() => saveWatermark(wmText, wmPos)}
              placeholder="예: @내채널 / 출처표기 (비우면 없음)"
              maxLength={60}
              className="flex-1 min-w-[160px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
            <select
              value={wmPos}
              onChange={(e) => {
                const p = e.target.value as "tl" | "tr" | "bl" | "br";
                setWmPos(p);
                saveWatermark(wmText, p);
              }}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="tl">좌상</option>
              <option value="tr">우상</option>
              <option value="bl">좌하</option>
              <option value="br">우하</option>
            </select>
          </div>
          <p className="mt-1 text-[10px] text-zinc-400">
            입력 후 칸 밖을 누르면 저장됩니다. 영상 모서리에 작은 반투명 글씨로 들어가요.
          </p>

          {errorStep === "compose" && error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
          {project.steps.compose.status === "error" && project.steps.compose.error && (
            <p className="mt-2 text-xs text-red-600">{project.steps.compose.error}</p>
          )}

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
                    <Spinner /> 합성 중… {composeLangLabel} ·{" "}
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
                  {composeLangLabel})
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


      {/* 썸네일 확대 라이트박스 — 아무 곳이나 누르면 닫힘. */}
      {zoomUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
          onClick={() => setZoomUrl(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={zoomUrl}
            alt="확대 이미지"
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
          />
          <button
            type="button"
            onClick={() => setZoomUrl(null)}
            aria-label="닫기"
            className="absolute top-4 right-4 flex size-9 items-center justify-center rounded-full bg-white/15 text-white text-lg hover:bg-white/25"
          >
            ✕
          </button>
        </div>
      )}
    </>
  );
}
