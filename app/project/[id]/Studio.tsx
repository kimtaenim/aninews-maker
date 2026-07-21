"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  STEP_ORDER,
  DEFAULT_SUBTITLE,
  type CastMember,
  type Project,
  type Scene,
  type StepKind,
  type SubtitleSettings,
  type ImageSourceMode,
  type VideoSourceMode,
} from "@/lib/types";
import { upload } from "@vercel/blob/client";
import { estimateDuration } from "@/lib/scenes";
import { stripMarks } from "@/lib/emphasis";
import type { SourceMaterial } from "@/lib/source";
import { resolveLang, otherLanguages } from "@/lib/languages";
import Spinner from "@/components/Spinner";
import ScenePreview from "./ScenePreview";
import type { ScriptReviewResult } from "@/lib/scriptReview";
import SceneVideoThumb, { useActiveRow } from "./SceneVideoThumb";
import CaptionControls from "./CaptionControls";
import { EMOTIONS } from "@/lib/emotions";
import MiniAudio from "./MiniAudio";
import SceneRecorder from "./SceneRecorder";
import AutoTextarea from "./AutoTextarea";

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

// 자막 위치 = 이미지에서 비워둘 지점(자막 자리). 자막 패널과 4단계 픽커가 함께 쓴다.
const SUBTITLE_POSITIONS = [
  ["top", "상단"],
  ["one-quarter", "¼"],
  ["one-third", "⅓"],
  ["center", "중앙"],
  ["two-thirds", "⅔"],
  ["three-quarters", "¾"],
  ["bottom", "하단"],
] as const;

// 자막 위치 → 인물·주요 물체가 생성될 영역 안내(사용자에게 보여줄 한국어). 이미지 프롬프트의
// edgeSafe(lib/image.ts)와 같은 규칙: 중앙 자막=상·하단, 상단/⅓=중앙보다 아래, ⅔/¾/하단=중앙보다 위.
function subtitleContentHint(pos?: string): string {
  switch (pos) {
    case "center":
      return "자막이 중앙 → 인물·주요 물체가 화면 상단과 하단에 생성돼요(가운데는 비움).";
    case "top":
    case "one-quarter":
    case "one-third":
      return "자막이 위쪽 → 인물·주요 물체가 화면 중앙보다 아래에 생성돼요.";
    case "two-thirds":
    case "three-quarters":
    case "bottom":
      return "자막이 아래쪽 → 인물·주요 물체가 화면 중앙보다 위에 생성돼요.";
    default:
      return "인물·주요 물체가 자막 반대편에 생성되도록 반영돼요.";
  }
}

// 5단계 카메라 워크 프리셋 — 고르면 그 씬 모션 프롬프트(영문)를 이 문구로 채운다.
// 모두 "카메라만 움직이고 인물·오브젝트는 거의 정지"를 명시(과한 피사체 움직임 방지).
const CAMERA_MOVES = [
  ["orbit", "⟳ 120° 오비트", "120-degree orbit: the camera travels in a wide arc AROUND the subject, revolving to the side so the background sweeps horizontally behind them — a clearly circular, revolving move. It must NOT look like a zoom or push-in: the distance to the subject stays constant and the subject stays the same size; only the viewing angle rotates around them. The subject and objects stay still while the camera circles."],
  ["zoom-in", "＋ 줌인", "Slow zoom in (push-in) toward the subject — camera only; the subject and objects barely move."],
  ["zoom-out", "－ 줌아웃", "Slow zoom out (pull-back) revealing more of the scene — camera only; the subject and objects barely move."],
  ["pan-h", "↔ 수평 팬", "Slow horizontal pan (left to right) across the scene — camera only; the subject and objects stay mostly still."],
  ["pan-v", "↕ 수직 팬", "Slow vertical pan/tilt (up and down) across the scene — camera only; the subject and objects stay mostly still."],
  ["dolly-zoom", "🎥 달리 줌", "Dolly-zoom (Vertigo effect): push the camera IN toward the subject so the SUBJECT GROWS bigger and fills more of the frame, while at the SAME TIME the BACKGROUND pulls AWAY and recedes into the distance — the sense of depth expands and the space behind the subject stretches back. A strong, deliberate perspective warp: the subject stays put while the world behind them rushes backward. Make the effect big and obvious, not subtle."],
  ["static", "■ 고정", "Locked-off static camera, no camera movement — only very subtle ambient motion; the subject stays still."],
] as const;

// ani-cliché 전용 — 로맨스 뮤직비디오 카메라. Grok v2 튜닝(2026-07-13): "Camera only /
// subject barely moves" 같은 정지 앵커는 과장 카메라 지시와 충돌해 밋밋하게 타협됨(실사용
// 확인) → 전부 제거하고, 시작→끝 프레이밍 변화와 속도를 명시. 검증되면 re-animator 이식.
const CLICHE_CAMERA_MOVES = [
  ["face-push", "💗 얼굴 푸시인", "Fast dramatic push-in that starts at a medium shot and ends slammed into an extreme close-up on the sparkling eyes — the framing changes completely, accelerating as it closes in. Hair drifts across the face; lens bloom flares at the end."],
  ["hair-blow", "🌬️ 머리카락 슬로우", "Dreamy slow-motion glamour shot: a strong wind whips the character's hair and clothes in big flowing waves while the camera arcs slowly around; strands catch dramatic backlight with heavy bloom — a shampoo-commercial hero shot, lush and exaggerated."],
  ["rack-eyes", "👁️ 눈 랙포커스", "Aggressive rack focus that SNAPS from a blurred foreground to razor-sharp glistening eyes, then a quick push-in right after the snap — a sudden heart-skip beat; a glint of light flashes across the eyes."],
  ["sparkle", "✨ 반짝 심쿵", "Push-in while the whole frame blooms: sparkles burst around the character, a blush rises, and the background melts into glowing bokeh — exaggerated shoujo-manga heart-flutter, framing tightening from waist-up to a close-up."],
  ["two-shot", "💞 투샷 드리프트", "Sweeping romantic crane-drift across the two leads: the camera glides in a wide arc from one face to the other, ending closer and lower than it started; bokeh lights streak past in the foreground."],
  ["speed-ramp", "🚀 스피드 램프", "Speed-ramped dolly-in: begins in dreamy slow motion, then SNAPS into a violently fast rush toward the subject, ending in a tight close-up — the speed change must be obvious and abrupt."],
  ["crash-in", "⚡ 크래시 줌인", "Crash zoom: the camera slams from a wide shot into an extreme close-up in a fraction of a second, motion blur streaking during the slam — explosive, abrupt, music-video punch."],
  ["vertigo", "🌀 현기증", "Extreme dolly-zoom vertigo: aggressive dolly-in while zooming out so the background warps and stretches violently around the subject — the perspective distortion must be strong and unmistakable."],
  ["whip-pan", "💨 휩 팬", "Violent whip pan streaking across the scene with heavy motion blur, then a hard stop reframing on the subject — fast, aggressive, energetic."],
  ["slow-orbit", "⟳ 느린 오비트", "Elegant orbit gliding a FULL sweep around the subject like a luxury perfume commercial — the background rotates completely behind them while dramatic rim light sweeps across the face; glossy, cinematic, starting wide and finishing closer."],
] as const;

// 4단계 이미지 스타일 칩 — 그룹별로 하나만 선택(그룹 간에는 자유 조합). 고르면 씬 이미지
// 프롬프트 끝에 [스타일: …] 지시로 붙는다. [id, 버튼라벨, 프롬프트 조각(영문)].
const IMG_CHIP_GROUPS = [
  {
    // 수직/기본 앵글 — 하나만(위↔아래·정면은 서로 배타).
    key: "vangle",
    label: "앵글",
    chips: [
      ["top-down", "위→아래", "high-angle top-down view"],
      ["bottom-up", "아래→위", "low-angle view looking up"],
      ["front", "정면", "straight-on front view at eye level"],
    ],
  },
  {
    // 대각선 — 독립 토글(다른 앵글과 조합 가능).
    key: "diagonal",
    label: "대각선",
    chips: [["diagonal", "대각선", "diagonal three-quarter angle"]],
  },
  {
    // 극단 퍼스 — 독립 토글(다른 앵글과 조합 가능).
    key: "persp",
    label: "퍼스",
    chips: [["extreme", "극단 퍼스", "extreme wide-angle perspective with dramatic foreshortening"]],
  },
  {
    // 인물 방향 — 앞모습/옆모습 하나만.
    key: "facing",
    label: "인물 방향",
    chips: [
      ["front-view", "앞모습", "the person faces the camera, front view of the body and face"],
      ["side-view", "옆모습", "the person shown from the side, profile view"],
    ],
  },
  {
    key: "bright",
    label: "배경 밝기",
    chips: [
      ["bright", "배경 밝게", "bright high-key background; keep the subject clearly lit"],
      ["dark", "배경 어둡게", "dark low-key moody background, but keep the subject clearly lit and visible"],
    ],
  },
  {
    key: "sat",
    label: "채도",
    chips: [
      ["vivid", "채도↑", "vivid highly saturated colors"],
      ["muted", "채도↓", "muted desaturated colors"],
    ],
  },
  {
    key: "detail",
    label: "디테일",
    chips: [
      ["minimal", "미니멀", "minimal clean simple composition"],
      ["ornate", "장식적", "richly detailed ornate decorative"],
    ],
  },
] as const;

export default function Studio({
  project: initial,
  styleProfiles,
  videoModels,
  tts,
  initialTitles,
  initialReview,
}: {
  project: Project;
  styleProfiles: { id: string; label: string }[];
  videoModels: { id: string; label: string }[];
  tts?: {
    default: "elevenlabs" | "typecast";
    configured: { elevenlabs: boolean; typecast: boolean };
    typecastVoices?: { fallback: boolean; perLang: Record<string, boolean> };
  };
  initialTitles?: {
    candidates: Array<{ title: string; structure?: string; rationale?: string; banned?: string[] }>;
    recommendedIndex: number;
    seoKeywords: string[];
  } | null;
  initialReview?: { result: ScriptReviewResult } | null;
}) {
  const [project, setProject] = useState<Project>(initial);
  // 롱폼(가로 16:9) 프로젝트면 이미지·미리보기 종횡비를 가로로. 없으면 세로 9:16(기존).
  const longAspect = project.format === "long" ? "aspect-[16/9]" : "aspect-[9/16]";
  // 자막 위치 — 롱폼(가로)은 ⅓·중앙·⅔ 3종만 노출(상단/¾/하단은 세로 전용). 세로는 6종 그대로.
  const subPositions =
    project.format === "long"
      ? SUBTITLE_POSITIONS.filter(
          ([v]) =>
            v === "one-quarter" ||
            v === "one-third" ||
            v === "center" ||
            v === "two-thirds" ||
            v === "three-quarters"
        )
      : SUBTITLE_POSITIONS;
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
    if (a.startsWith("source")) return "source";
    if (a.startsWith("script") || a === "save") return "script";
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
  // 음성(6단계) 전용 busy 레인 — 시각(이미지·영상) busy 와 독립이라 병렬로 돌 수 있다.
  // (음성 저장은 서버에서 재읽기-머지하므로 동시 저장이 서로 안 덮어쓴다.)
  const [voiceBusy, _setVoiceBusy] = useState<string | null>(null);
  function setVoiceBusy(action: string | null) {
    _setVoiceBusy(action);
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

  // 4단계: 선택한 씬만 일괄 생성/리롤 (선택 안 된 건 그대로). 5단계와 공유.
  const [selectedScenes, setSelectedScenes] = useState<Set<number>>(new Set());
  function toggleScene(i: number) {
    setSelectedScenes((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }
  function clearSelectedScenes() {
    setSelectedScenes(new Set());
  }
  // 전체 선택 — 각 단계에서 실제 생성 대상이 되는 씬만 고른다(생성 함수 필터와 동일 기준).
  // 이미지(4): 씬0=키프레임 제외 + 프롬프트 없음·업로드·건너뜀 제외(skipInBatch). 비디오(5): 업로드 모드만 제외.
  function selectAllImageScenes() {
    setSelectedScenes(
      new Set(project.scenes.map((_, i) => i).filter((i) => i >= 1 && !skipInBatch(i)))
    );
  }
  function selectAllVideoScenes() {
    setSelectedScenes(
      new Set(project.scenes.map((s, i) => i).filter((i) => project.scenes[i].videoSource !== "upload"))
    );
  }

  // 5단계 비디오 모델 (프로바이더 교차: fal / grok)
  const [videoModelId, setVideoModelId] = useState(
    initial.videoModelId || videoModels[0]?.id || ""
  );
  // 5단계 영상 그리드 — 크롬 부담 줄이려고 "보이는 한 줄"만 재생한다(2열=2개, 3열=3개).
  const videoGridRef = useRef<HTMLOListElement>(null);
  const { cols: videoCols, activeRow: videoActiveRow } = useActiveRow(
    videoGridRef,
    project.scenes.length
  );
  // 5단계 영상 생성 공통 프롬프트 — 전 씬 영상에 공통으로 덧붙는 지시. 프로젝트별 저장.
  const [videoCommonPrompt, setVideoCommonPrompt] = useState(initial.videoCommonPrompt ?? "");
  async function saveVideoCommonPrompt(v: string) {
    try {
      await call("/api/project/video-prompt", { projectId: project.id, prompt: v });
      setProject((p) => ({ ...p, videoCommonPrompt: v.trim() || undefined }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "공통 프롬프트 저장 실패");
    }
  }
  // 씬별 모션 크기 — 뉴스는 기본 잔잔, 클리셰는 기본 크게(MV 카메라). 씬별로 바꿀 수 있다.
  const [motionScale, setMotionScale] = useState<Record<number, "subtle" | "large">>({});
  const defaultMotionScale: "subtle" | "large" = initial.mode === "cliche" ? "large" : "subtle";
  // 씬별 선택한 카메라 워크(하이라이트용). 고르면 그 씬 모션 프롬프트를 프리셋으로 채운다.
  const [cameraMove, setCameraMove] = useState<Record<number, string>>({});
  // 4단계 스타일 칩 — 씬별 { 그룹키: 선택 칩id }. 그룹당 하나만. 프롬프트 [스타일: …] 반영.
  const [imgChips, setImgChips] = useState<Record<number, Record<string, string>>>({});

  // 자막 설정 (프로젝트 일괄)
  const [sub, setSub] = useState<SubtitleSettings>(initial.subtitle ?? DEFAULT_SUBTITLE);

  const router = useRouter();
  // 다른 언어판(별도 프로젝트) 생성 상태.
  const [creatingVersion, setCreatingVersion] = useState<string | null>(null);
  const [versionError, setVersionError] = useState<string | null>(null);
  // 합성/표시용 이 프로젝트의 언어 라벨. 원본은 한국어판, 다국어판은 그 언어판.
  const composeLangLabel = initial.lang
    ? `${resolveLang(initial.lang)?.label ?? initial.lang}판`
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
    // 새 엔진에 없는 목소리는 해제(기본으로) — 다른 엔진 voice id 를 넘겨 합성 실패 방지.
    const cur = voices.find((x) => x.id === voiceId);
    if (voiceId && cur && cur.provider !== p) void saveVoice("");
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

  // 보이스오버 목소리(프로젝트당 하나) — config/voices.json 목록에서 엔진에 맞는 걸 고름.
  const [voiceId, setVoiceId] = useState<string>(initial.voiceId ?? "");
  // [cliche] 화자별 목소리 (speaker → voiceId).
  const [castVoices, setCastVoices] = useState<Record<string, string>>(initial.castVoices ?? {});
  const [voices, setVoices] = useState<
    { id: string; name: string; provider: string; note?: string; narration?: boolean }[]
  >([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/tts/voices")
      .then((r) => r.json())
      .then((d) => {
        if (alive && d?.ok) setVoices(d.voices ?? []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  async function saveVoice(id: string, speaker?: string) {
    if (speaker) {
      // [cliche] 화자별 목소리 저장.
      const prev = castVoices;
      const next = { ...castVoices };
      if (id) next[speaker] = id;
      else delete next[speaker];
      setCastVoices(next);
      setProject((pr) => ({ ...pr, castVoices: Object.keys(next).length ? next : undefined }));
      try {
        await call("/api/project/voice", { projectId: project.id, voiceId: id, speaker });
      } catch (e) {
        setCastVoices(prev);
        setError(e instanceof Error ? e.message : "목소리 저장 실패");
      }
      return;
    }
    if (id === voiceId) return;
    const prev = voiceId;
    setVoiceId(id);
    setProject((pr) => ({ ...pr, voiceId: id || undefined }));
    try {
      await call("/api/project/voice", { projectId: project.id, voiceId: id });
    } catch (e) {
      setVoiceId(prev); // 실패 시 롤백
      setError(e instanceof Error ? e.message : "목소리 저장 실패");
    }
  }

  // 목소리 미리듣기 — 선택한 목소리로 짧은 샘플을 합성해 재생.
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  async function previewVoice(vId?: string) {
    setError(null);
    setPreviewBusy(true);
    try {
      const r = await fetch("/api/tts/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: ttsProvider, voiceId: vId ?? voiceId }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      const url = URL.createObjectURL(await r.blob());
      previewAudioRef.current?.pause();
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (e) {
      setError(e instanceof Error ? e.message : "미리듣기 실패");
    } finally {
      setPreviewBusy(false);
    }
  }

  // 워터마크 (최종 출력에 새김) — 텍스트 + 위치(4모서리)
  const [wmText, setWmText] = useState(initial.watermark?.text ?? "");
  const [wmPos, setWmPos] = useState<"tl" | "tr" | "bl" | "br">(
    initial.watermark?.position ?? "br"
  );
  // 제작 크레딧 이름 — 마지막 2씬에 "제작 : {이름}"을 워터마크 옆에 1.5배로.
  const [wmCredit, setWmCredit] = useState(initial.credit ?? "");
  // 제목 클릭 편집
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(initial.title);
  // 제목 자동 생성(뉴스) — 확정 대본으로 후보 3개 + 추천 + SEO.
  const [titleCands, setTitleCands] = useState<
    Array<{ title: string; structure?: string; rationale?: string; banned?: string[] }> | null
  >(initialTitles?.candidates ?? null);
  const [titleRec, setTitleRec] = useState(initialTitles?.recommendedIndex ?? 0);
  const [titleSeo, setTitleSeo] = useState<string[]>(initialTitles?.seoKeywords ?? []);
  const [titleGenBusy, setTitleGenBusy] = useState(false);
  const [titleGenErr, setTitleGenErr] = useState("");
  const [copiedTitleIdx, setCopiedTitleIdx] = useState<number | null>(null);
  // 대본 구조 검수(열린 고리) — 승인과 분리된 별도 버튼. 미리 돌려 진단·수정안을 보고 고친다(승인 안 함).
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewErr, setReviewErr] = useState("");
  // 초기값 = 서버에 저장된 지난 다듬기 결과(대본이 그대로일 때만 page.tsx 가 넘김). 통과면 배지,
  // 위반이면 reviewData 만 심어두고 모달은 자동으로 안 띄운다('결과 다시 보기'로 복원).
  const [reviewPassed, setReviewPassed] = useState(!!initialReview?.result.pass);
  const [reviewData, setReviewData] = useState<ScriptReviewResult | null>(initialReview?.result ?? null);
  const [reviewStage, setReviewStage] = useState<null | "consent" | "revise">(null);
  const [selectedRev, setSelectedRev] = useState<Set<number>>(new Set());
  async function saveTitle() {
    const t = titleInput.trim();
    setEditingTitle(false);
    if (!t || t === project.title) return;
    try {
      await call("/api/project/title", { projectId: project.id, title: t });
      setProject((p) => ({ ...p, title: t }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "제목 변경 실패");
    }
  }

  // 6단계 자막 클릭 → 2단계 그 씬으로 스크롤 + 나레이션 포커스(거기서 수정·행갈이).
  function goToScriptScene(i: number) {
    const el = document.getElementById(`script-scene-${i}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    (el.querySelector("textarea") as HTMLTextAreaElement | null)?.focus();
  }
  // 미리보기 "다시 녹음" → 6단계(음성) 그 씬으로 스크롤 — 거기서 녹음/음성 생성.
  function goToVoiceScene(i: number) {
    const el = document.getElementById(`voice-scene-${i}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  // 미리보기에서 자막 줄바꿈(행) 편집 저장 — 2단계 편집과 같은 경로(patchScene→자동저장)로
  // 나레이션 갱신. 캡션은 나레이션의 줄바꿈으로 분할되므로 저장 즉시 미리보기가 다시 싱크된다.
  // (줄바꿈은 발음에 영향 없음 — 음성 재생성 불필요.) 미리보기 즉시 반영 위해 project 도 낙관적 갱신.
  function saveSubtitleLines(i: number, text: string) {
    patchScene(i, { narration: text });
    setProject((p) => ({
      ...p,
      scenes: p.scenes.map((s, idx) => (idx === i ? { ...s, narration: text } : s)),
    }));
  }
  async function saveWatermark(
    text: string,
    position: "tl" | "tr" | "bl" | "br",
    credit: string
  ) {
    try {
      await call("/api/project/watermark", {
        projectId: project.id,
        watermark: { text, position },
        credit,
      });
      setProject((p) => ({
        ...p,
        watermark: text.trim() ? { text: text.trim(), position } : undefined,
        credit: credit.trim() || undefined,
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
        if (d.status === "generated" && (d.finalVideoUrl || d.cleanVideoUrl)) {
          bumpMutation(); // 확정된 합성본 URL — 낡은 /state 동기화가 못 지우게
          setProject((p) => ({
            ...p,
            finalVideoUrl: (d.finalVideoUrl as string) ?? p.finalVideoUrl,
            cleanVideoUrl: (d.cleanVideoUrl as string) ?? p.cleanVideoUrl,
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
      <div className="grid gap-2">
        <p className="text-[10px] text-zinc-500">
          📝 <span className="font-medium">자막</span> = 화면에 나오는 <span className="font-medium">글자</span> 디자인 (목소리·더빙과 별개)
        </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
        {(
          [
            ["font", "폰트", [["sans", "산세리프"], ["serif", "세리프"]]],
            ["weight", "굵기", [["regular", "보통"], ["bold", "볼드"]]],
            ["size", "크기", [["small", "작게"], ["medium", "보통"], ["large", "크게"]]],
            ["position", "위치", subPositions],
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
      </div>
    );
  }

  // 7단계: 합성 — worker 에 작업 적재. 진행 추적은 서버 상태 + runComposePoll 이 담당하므로
  // 이 함수가 끝나도(페이지를 떠나도) 합성은 계속되고, 돌아오면 자동으로 이어진다.
  // clean=true 는 "영상만" 합성(보이스·자막·효과음·워터마크 제외 — 소재용 다운로드).
  // 결과는 cleanVideoUrl 에 저장돼 정식 합성본(finalVideoUrl)을 덮지 않는다.
  async function startCompose(clean = false) {
    setError(null);
    setBusy("compose");
    try {
      // 자막 설정 버튼은 누를 때마다 비동기 저장(POST)이라, 누르자마자 합성하면 직전
      // 변경(예: "작게")이 아직 Redis 에 안 닿아 worker 가 이전 값으로 구울 수 있다.
      // → 현재 화면의 자막 설정을 먼저 확실히 저장한 뒤 합성 큐에 넣는다.
      await call("/api/project/subtitle", { projectId: project.id, subtitle: sub });
      await call("/api/compose", { projectId: project.id, lang: "ko", ...(clean ? { clean: true } : {}) });
      const now = Date.now();
      composeStartRef.current = now;
      setProject((p) => ({
        ...p,
        ...(clean ? { cleanVideoUrl: undefined } : { finalVideoUrl: undefined }),
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
  // 1단계 소스 대화 (소스 자료를 대화로 다듬기/조합)
  const [sourceChat, setSourceChat] = useState(initial.steps.source.chat);
  const [sourceChatInput, setSourceChatInput] = useState("");
  // 2단계 스크립트 대화 (씬 나레이션을 대화로 수정)
  const [scriptChat, setScriptChat] = useState(initial.steps.script.chat);
  const [scriptChatInput, setScriptChatInput] = useState("");
  // 스크립트 전체 복사 — 눌렀을 때 잠깐 "복사됨" 표시.
  const [copiedScript, setCopiedScript] = useState(false);
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
    project.scenes.length > 0 && project.scenes.every((s) => s.skipped || s.mood || !!s.audioUrl);

  // 음성(TTS) 전용 스크립트 편집 버퍼 — 자막(narration)으로 미리 채워 바로 편집 가능
  // (placeholder 만 떠서 회색 글씨를 선택·수정 못 하던 문제 해소). 비우면 자막이 그대로 쓰인다.
  // 오버라이드(실제 ttsScript)만 담는다. 비어 있으면(키 없음) 화면엔 그 씬의 현재
  // 나레이션을 보여주고 음성도 나레이션을 쓴다 → 2단계에서 나레이션 고치면 자동 동기화.
  const [ttsScripts, setTtsScripts] = useState<Record<number, string>>(
    Object.fromEntries(
      initial.scenes
        .filter((s) => (s.ttsScript ?? "").trim() && s.ttsScript !== s.narration)
        .map((s) => [s.index, s.ttsScript as string])
    )
  );
  const [ttsDirty, setTtsDirty] = useState(false);

  // 새 씬 컴포저: 나레이션 입력 + Enter → 프롬프트·모션·길이 자동 생성.
  const [composerOpen, setComposerOpen] = useState(false);
  const [newNarration, setNewNarration] = useState("");

  function patchScene(i: number, patch: Partial<EditScene>) {
    // 자막(narration)의 "말"이 바뀌면 그 씬의 음성대본 오버라이드를 비워 자막을 따라가게
    // 한다(단방향: 자막→음성). 단, 강조 마커([[ ]])만 바뀐 경우는 발음이 그대로이므로
    // 오버라이드를 유지한다(stripMarks 로 비교). 백엔드도 같은 규칙.
    if (patch.narration !== undefined) {
      const before = stripMarks(scenes[i]?.narration ?? "");
      const after = stripMarks(patch.narration ?? "");
      if (before !== after) {
        setTtsScripts((prev) => {
          if (!(i in prev)) return prev;
          const next = { ...prev };
          delete next[i];
          return next;
        });
      }
    }
    setScenes((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
    setDirty(true);
  }

  // 나레이션 편집기(2단계) 참조 — 강조 버튼이 현재 선택 영역을 [[ ]] 로 감싼다.
  const narrRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});

  // 선택한 부분을 강조 마크업 [[ ]] 로 토글(이미 감싸져 있으면 해제). 드래그로 원하는
  // 만큼만(조사 빼고 등) 정확히 선택해 누르면 그 조각만 크게·강조색으로 나온다(음성 무관).
  function wrapEmphasis(i: number) {
    const el = narrRefs.current[i];
    if (!el) return;
    const s = el.selectionStart ?? 0;
    const e = el.selectionEnd ?? 0;
    if (s === e) return; // 선택 없음
    const v = el.value;
    const sel = v.slice(s, e);
    const wrapped = sel.length > 4 && sel.startsWith("[[") && sel.endsWith("]]");
    const inner = wrapped ? sel.slice(2, -2) : "[[" + sel + "]]";
    const next = v.slice(0, s) + inner + v.slice(e);
    patchScene(i, { narration: next });
    const ns = wrapped ? s : s + 2;
    const ne = wrapped ? e - 4 : e + 2;
    requestAnimationFrame(() => {
      const el2 = narrRefs.current[i];
      if (el2) {
        el2.focus();
        el2.setSelectionRange(ns, ne);
      }
    });
  }

  function addScene() {
    setScenes((prev) => [
      ...prev,
      { narration: "", imagePrompt: "", motion: "", durationSec: 5 },
    ]);
    // 미디어 배열(project.scenes)도 같은 길이로 — 편집 그리드가 두 배열을 같은 index 로
    // 묶고, 저장 라우트도 index 로 산출물을 carry 하므로 항상 정렬돼 있어야 한다.
    setProject((p) => ({
      ...p,
      scenes: [
        ...p.scenes,
        { index: p.scenes.length, narration: "", imagePrompt: "", motion: "", durationSec: 5, status: "generated" },
      ],
    }));
    setDirty(true);
  }
  // 나레이션만으로 새 씬 추가 — 길이는 글자수로 자동, 프롬프트·모션은 3~5단계에서.
  function addSceneFromNarration() {
    const n = newNarration.trim();
    if (!n) return;
    const dur = estimateDuration(n);
    setScenes((prev) => [...prev, { narration: n, imagePrompt: "", motion: "", durationSec: dur }]);
    setProject((p) => ({
      ...p,
      scenes: [
        ...p.scenes,
        { index: p.scenes.length, narration: n, imagePrompt: "", motion: "", durationSec: dur, status: "generated" },
      ],
    }));
    setDirty(true);
    setNewNarration(""); // 다음 씬을 바로 이어 입력할 수 있게 비움(컴포저는 열린 채).
  }
  function deleteScene(i: number) {
    setScenes((prev) => prev.filter((_, idx) => idx !== i));
    // 미디어도 같은 씬을 제거하고 index 재부여 — 안 그러면 삭제 지점 이후 씬들의
    // 이미지/영상/음성이 한 칸씩 밀려 엉뚱하게 붙는다(저장 시 carry 오정렬).
    setProject((p) => ({
      ...p,
      scenes: p.scenes.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, index: idx })),
    }));
    setDirty(true);
  }
  // 씬 순서 변경 — 서버가 씬 객체를 통째로 옮긴다(모든 단계 산출물이 함께 이동·싱크).
  // 어느 단계에서든 호출 가능. 미저장 편집을 먼저 flush 한 뒤 재정렬해 최신 기준으로 옮긴다.
  async function moveScene(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= project.scenes.length || busy !== null) return;
    setError(null);
    setBusy("script-reorder");
    try {
      await flushScenes();
      const data = await call("/api/scene/reorder", { projectId: project.id, from: i, to: j });
      const saved = data.scenes as Scene[];
      setProject((p) => ({ ...p, scenes: saved }));
      setScenes(saved.map(toEdit));
      setDirty(false);
      bumpMutation(); // 진행 중이던 /state 동기화가 재정렬 결과를 덮지 않도록
    } catch (e) {
      setError(e instanceof Error ? e.message : "순서 변경 실패");
    } finally {
      setBusy(null);
    }
  }
  // 씬 순서 ↑↓ 버튼 — 어느 단계에서든 재사용. 재정렬은 모든 단계에 함께 반영된다.
  // minIndex: 이 인덱스 밑으로는 못 내려감(4단계 이미지는 씬0=키프레임 앵커라 minIndex=1).
  function renderReorder(i: number, minIndex = 0) {
    const reordering = busy === "script-reorder";
    return (
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          onClick={() => moveScene(i, -1)}
          disabled={i <= minIndex || busy !== null}
          title="위 씬과 순서 바꾸기 (이미지·영상·음성 모두 함께 이동)"
          className="rounded px-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
          aria-label="위로"
        >
          {reordering ? "…" : "↑"}
        </button>
        <button
          type="button"
          onClick={() => moveScene(i, 1)}
          disabled={i === project.scenes.length - 1 || busy !== null}
          title="아래 씬과 순서 바꾸기 (이미지·영상·음성 모두 함께 이동)"
          className="rounded px-1 text-zinc-500 hover:bg-zinc-200 dark:hover:bg-zinc-800 disabled:opacity-30"
          aria-label="아래로"
        >
          {reordering ? "…" : "↓"}
        </button>
      </span>
    );
  }
  // 빈 씬을 afterIndex 뒤에 삽입 — 서버가 직접 splice 해 뒤 씬 산출물(imageUrl/videoUrl/
  // audioUrl)을 배열과 함께 보존(중간 삽입 시 클라이언트 index carry 어긋남 회피).
  // 미저장 편집은 먼저 flush 하고, 반환된 씬으로 버퍼를 재구성한다.
  async function insertSceneAt(afterIndex: number, mood = false) {
    if (busy !== null) return;
    try {
      await flushScenes();
      const data = await call("/api/script/insert", {
        projectId: project.id,
        insertAfterIndex: afterIndex,
        ...(mood ? { mood: true } : {}),
      });
      const saved = data.scenes as Scene[];
      setProject((p) => ({ ...p, scenes: saved }));
      setScenes(saved.map(toEdit));
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "씬 추가 실패");
    }
  }
  // 씬 건너뛰기 토글 — /api/scene/source 로 즉시 저장. 건너뛴 씬은 이미지·영상·음성
  // 생성/합성/완료판정에서 제외된다.
  async function toggleSkip(i: number) {
    const next = !project.scenes[i]?.skipped;
    try {
      const data = await call("/api/scene/source", {
        projectId: project.id,
        sceneIndex: i,
        skipped: next,
      });
      const saved = data.scene as Scene;
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s, idx) => (idx === i ? saved : s)),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "건너뛰기 변경 실패");
    }
  }

  async function call(path: string, payload: object) {
    const r = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    // 에러 응답이 JSON 이 아닐 수 있다(예: Vercel 타임아웃의 텍스트 페이지) — 텍스트로 읽고
    // 파싱을 시도해, 실패해도 "not valid JSON" 대신 사람이 읽을 메시지를 낸다.
    const raw = await r.text();
    let data: { ok?: boolean; error?: string } & Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      const timeout = /FUNCTION_INVOCATION_TIMEOUT|An error occurred/i.test(raw);
      throw new Error(
        timeout
          ? "서버 처리 시간이 초과됐어요 — 잠시 후 다시 시도해주세요"
          : `서버 응답 오류 (HTTP ${r.status}): ${raw.slice(0, 120)}`
      );
    }
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
      captionStyle?: string | null;
      narration?: string;
      emotion?: string | null;
      speaker?: string | null;
      voiceId?: string | null;
      lines?: { text: string; speaker?: string; emotion?: string }[];
      mood?: boolean;
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
              // 미리보기에서 자막 강조를 편집하면 나레이션도 동기화(2단계 버퍼와 lockstep).
              narration: saved.narration,
              imageSource: saved.imageSource ?? "generate",
              referenceImageUrl: saved.referenceImageUrl,
              paletteHint: saved.paletteHint,
              videoSource: saved.videoSource ?? "generate",
            }
          : s
      )
    );
  }

  // 씬별 자막 스타일 프리셋 저장 → project.scenes 갱신(미리보기·최종 합성에 반영).
  async function setCaptionStyle(i: number, id: string) {
    setError(null);
    try {
      await patchSceneSource(i, { captionStyle: id || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "자막 스타일 저장 실패");
    }
  }

  // [cliche] 씬 감정 연기 저장 → 음성 생성 시 오디오 태그로 과장 연기.
  async function setEmotion(i: number, id: string) {
    setError(null);
    try {
      await patchSceneSource(i, { emotion: id || null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "감정 저장 실패");
    }
  }

  // [cliche] 씬 줄(lines) 편집 — 줄마다 화자·텍스트·감정. 저장하면 줄들을 이어 다시 더빙.
  // lines 가 없으면 나레이션을 줄바꿈으로 쪼개 파생(옛 프로젝트·수동 편집도 줄별 화자 지정 가능).
  function sceneLines(i: number): { text: string; speaker?: string; emotion?: string }[] {
    const s = project.scenes[i];
    if (s?.lines?.length) {
      return s.lines.map((l) => ({ text: l.text, speaker: l.speaker, emotion: l.emotion }));
    }
    return (s?.narration ?? "")
      .split(/\n+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => ({ text: t }));
  }
  async function saveLines(i: number, lines: { text: string; speaker?: string; emotion?: string }[]) {
    setError(null);
    try {
      await patchSceneSource(i, { lines });
    } catch (e) {
      setError(e instanceof Error ? e.message : "대사 저장 실패");
    }
  }
  function editLine(i: number, li: number, patch: Partial<{ text: string; speaker: string; emotion: string }>) {
    saveLines(i, sceneLines(i).map((l, x) => (x === li ? { ...l, ...patch } : l)));
  }
  function addLine(i: number) {
    saveLines(i, [...sceneLines(i), { text: "", speaker: "내레이션" }]);
  }
  function removeLine(i: number, li: number) {
    saveLines(i, sceneLines(i).filter((_, x) => x !== li));
  }
  // [cliche] 분위기 씬 ↔ 일반 씬 전환 — 스크립트가 자동으로 넣은 분위기 씬에 대사를 넣고
  // 싶을 때(반대로도) 쓴다. mood=true 전환 시 서버가 낡은 더빙도 무효화한다.
  async function toggleMood(i: number, mood: boolean) {
    setError(null);
    try {
      await patchSceneSource(i, { mood });
    } catch (e) {
      setError(e instanceof Error ? e.message : "분위기 씬 전환 실패");
    }
  }
  // [cliche] 감정 연기 게이트 — 감정 오디오 태그는 ElevenLabs 전용(Typecast 미지원).
  // 합성과 같은 규칙(Typecast id = "tc_" 프리픽스)으로 이 줄/씬의 실효 목소리 엔진을 판별해,
  // Typecast 로 더빙될 대사엔 감정 UI 를 잠근다(선택해봤자 무시되는 걸 명시).
  function isTypecastVoiceId(vId?: string): boolean {
    if (vId) return vId.startsWith("tc_");
    return ttsProvider === "typecast"; // 목소리 미지정이면 프로젝트 엔진 기본을 따라감
  }
  // 줄(li)의 실효 목소리 — 화자 캐스케이드(빈 화자는 윗줄 따라감) 후 castVoices → 프로젝트 목소리.
  // (줄별 더빙 라우트 app/api/audio/scene 의 우선순위와 동일하게 유지할 것.)
  function lineVoiceId(i: number, li: number): string | undefined {
    const lines = sceneLines(i);
    let sp = "";
    for (let k = 0; k <= li && k < lines.length; k++) {
      const s = (lines[k].speaker ?? "").trim();
      if (s) sp = s;
    }
    return (sp ? castVoices[sp] : undefined) || voiceId || undefined;
  }
  // 씬(레거시 단일 화자 경로)의 실효 목소리 — scene.voiceId → castVoices[speaker] → 프로젝트.
  function sceneVoiceId(i: number): string | undefined {
    const s = project.scenes[i];
    return s?.voiceId || (s?.speaker ? castVoices[s.speaker] : undefined) || voiceId || undefined;
  }

  // [cliche] 효과음 — 설명 → 생성(ElevenLabs) → 씬 저장. 합성 때 목소리 밑에 믹싱.
  const [sfxText, setSfxText] = useState<Record<number, string>>({});
  const [sfxBusy, setSfxBusy] = useState<number | null>(null);
  async function genSfx(i: number) {
    const text = (sfxText[i] ?? project.scenes[i]?.sfx ?? "").trim();
    if (!text) return;
    setSfxBusy(i);
    setError(null);
    try {
      const durationSec = Math.min(22, Math.max(1, Math.round(project.scenes[i]?.durationSec ?? 5)));
      const data = await call("/api/audio/sfx", { projectId: project.id, sceneIndex: i, text, durationSec });
      setProject((p) => ({
        ...p,
        scenes: p.scenes.map((s, x) =>
          x === i
            ? { ...s, sfx: text, sfxUrl: data.url as string, sfxVolume: typeof s.sfxVolume === "number" ? s.sfxVolume : 0.35 }
            : s
        ),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "효과음 생성 실패");
    } finally {
      setSfxBusy(null);
    }
  }
  async function setSfxVolume(i: number, v: number) {
    setProject((p) => ({ ...p, scenes: p.scenes.map((s, x) => (x === i ? { ...s, sfxVolume: v } : s)) }));
    try {
      await call("/api/scene/source", { projectId: project.id, sceneIndex: i, sfxVolume: v });
    } catch (e) {
      setError(e instanceof Error ? e.message : "볼륨 저장 실패");
    }
  }
  // ── [cliche] 출연진 포트레이트 재편집 — 설명 생성/사진 업로드→웹툰 변환 → castMembers 저장 ──
  const [faceBusy, setFaceBusy] = useState<string | null>(null); // 인물 이름
  const [faceDesc, setFaceDesc] = useState<Record<string, string>>({});
  const [faceOpen, setFaceOpen] = useState<Record<string, boolean>>({});
  const castFaceRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const memberOf = (name: string) => project.castMembers?.find((mm) => mm.name === name);

  async function saveCastMember(name: string, patch: Partial<CastMember>) {
    const data = await call("/api/project/cast", {
      projectId: project.id,
      member: { name, ...patch },
    });
    setProject((p) => ({
      ...p,
      castMembers: (data.castMembers as CastMember[]) ?? p.castMembers,
    }));
  }
  // uploadUrl 있으면 사진→웹툰 변환, 없으면 설명 생성. 포트레이트 생성은 무상태 API 라
  // 생성 후 castMembers 패치로 저장(저장은 짧은 창 — 경합 규약 준수).
  async function genCastPortrait(name: string, uploadUrl?: string) {
    const m = memberOf(name);
    const desc = (faceDesc[name] ?? m?.faceDesc ?? "").trim();
    if (!uploadUrl && !desc && !m?.archetype && !name) {
      setError("외모 설명을 입력하거나 사진을 올려주세요");
      return;
    }
    setError(null);
    setFaceBusy(name);
    try {
      const data = await call("/api/cast/portrait", {
        projectId: project.id,
        styleProfileId: project.styleProfileId,
        name,
        archetype: m?.archetype || undefined,
        description: desc || undefined,
        uploadUrl,
      });
      await saveCastMember(name, {
        portraitUrl: data.url as string,
        faceSource: uploadUrl ? "upload" : "generate",
        ...(uploadUrl ? { faceUploadUrl: uploadUrl } : {}),
        ...(desc ? { faceDesc: desc } : {}),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "포트레이트 생성 실패");
    } finally {
      setFaceBusy(null);
    }
  }
  async function uploadCastFace(name: string, file: File) {
    setError(null);
    try {
      const url = await uploadFile(file, `cast-${name}`);
      await genCastPortrait(name, url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "사진 업로드 실패");
    }
  }

  async function clearSfx(i: number) {
    setProject((p) => ({ ...p, scenes: p.scenes.map((s, x) => (x === i ? { ...s, sfxUrl: undefined, sfx: undefined } : s)) }));
    try {
      await call("/api/scene/source", { projectId: project.id, sceneIndex: i, sfxUrl: null, sfx: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : "효과음 제거 실패");
    }
  }
  function playSfx(url: string) {
    previewAudioRef.current?.pause();
    const a = new Audio(url);
    previewAudioRef.current = a;
    a.play().catch(() => {});
  }

  // [cliche] 인물 이름 목록 — 저장된 cast 우선, 없으면 씬 화자에서 파생(내레이션 제외).
  const cast = project.cast?.length
    ? project.cast
    : [
        ...new Set(
          project.scenes
            .map((s) => s.speaker)
            .filter((s): s is string => !!s && s !== "내레이션")
        ),
      ];
  async function renameCast(from: string, to: string) {
    const t = to.trim();
    if (!t || t === from) return;
    setError(null);
    try {
      await call("/api/project/cast", { projectId: project.id, rename: { from, to: t } });
      setProject((p) => ({
        ...p,
        cast: (p.cast ?? []).map((c) => (c === from ? t : c)),
        castVoices: p.castVoices
          ? Object.fromEntries(
              Object.entries(p.castVoices).map(([k, v]) => [k === from ? t : k, v])
            )
          : p.castVoices,
        scenes: p.scenes.map((s) => (s.speaker === from ? { ...s, speaker: t } : s)),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "인물 이름 변경 실패");
    }
  }

  // 이미 만든 그림을 실사(사진·영화)로 변환 — 구도 유지, 화풍만. sceneIndex 0 = 키프레임.
  async function convertRealistic(sceneIndex: number) {
    setError(null);
    setBusy(`convert-${sceneIndex}`);
    try {
      const data = await call("/api/image/convert", { projectId: project.id, sceneIndex });
      const url = data.url as string;
      setProject((p) =>
        sceneIndex === 0
          ? { ...p, keyframeUrl: url }
          : {
              ...p,
              scenes: p.scenes.map((s, i) =>
                i === sceneIndex ? { ...s, imageUrl: url, status: "generated" } : s
              ),
            }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "실사 변환 실패");
    } finally {
      setBusy(null);
    }
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
      setBusy(null);
      return;
    }
    setBusy(null);
    // 승인 직후 아직 씬이 없으면 스크립트를 자동 생성 — 2단계에서 한 번 더 안 눌러도 되게.
    // (이미 스크립트가 있으면 덮어쓰지 않는다.)
    if (project.scenes.length === 0) {
      await generateScript();
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
  // 저장 실패의 서버 메시지 — "저장 실패"만 떠서 원인을 모르던 문제(예: 나레이션 필수 422).
  const [saveErrMsg, setSaveErrMsg] = useState<string | null>(null);
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
      setSaveErrMsg(null);
    } catch (e) {
      setSaveErrMsg(e instanceof Error ? e.message : null);
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
      setSaveErrMsg(null);
    } catch (e) {
      setSaveErrMsg(e instanceof Error ? e.message : null);
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
    if (saveState === "error")
      return (
        <span className="text-[11px] text-red-600">
          저장 실패{saveErrMsg ? `: ${saveErrMsg}` : ""} — 다시 편집하면 재시도
        </span>
      );
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
      await flushScenes(); // 미저장 편집 먼저 저장 — 뒤늦은 자동저장이 방금 만든 프롬프트를 덮어쓰지 않게
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
      await flushScenes(); // 미저장 편집 먼저 저장 — 뒤늦은 자동저장이 방금 만든 모션을 덮어쓰지 않게
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
      .filter(({ s }) => !s.skipped && (s.narration ?? "").trim() && !(s.motion ?? "").trim())
      .map(({ i }) => i);
    if (need.length === 0) return;
    autoMotionRef.current = true;
    void genMotions(need, "video-motion");
    // genMotions 는 매 렌더 재생성되므로 deps 에서 제외(autoMotionRef 가 1회 보장).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagesApproved, project.scenes]);

  // 4단계 진입(키프레임 승인) 시, 이미지 프롬프트가 빈 씬(씬0=키프레임 제외)을 한 번 자동
  // 생성한다. "전체 프롬프트 생성" 버튼을 안 눌러도 채워지게. 이미 프롬프트 있으면 안 건드림(리롤 수동).
  const autoImgPromptRef = useRef(false);
  useEffect(() => {
    if (!keyframeApproved || autoImgPromptRef.current || busyRef.current) return;
    const need = project.scenes
      .map((s, i) => ({ i, s }))
      .filter(
        ({ i, s }) =>
          i >= 1 && !s.skipped && (s.narration ?? "").trim() && !(s.imagePrompt ?? "").trim()
      )
      .map(({ i }) => i);
    if (need.length === 0) return;
    autoImgPromptRef.current = true;
    void genImagePrompts(need, "scene-prompts");
    // genImagePrompts 는 매 렌더 재생성되므로 deps 에서 제외(autoImgPromptRef 가 1회 보장).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyframeApproved, project.scenes]);

  // 제목 자동 생성 — 확정 대본으로 후보 3개. 뉴스만(클리셰 제외). 실패해도 확정엔 영향 없음.
  async function genTitles() {
    if (project.mode === "cliche") return;
    setTitleGenBusy(true);
    setTitleGenErr("");
    try {
      const r = await fetch("/api/title/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok) throw new Error(d.error || "제목 생성 실패");
      setTitleCands(d.candidates ?? []);
      const rec = typeof d.recommended_index === "number" ? d.recommended_index : 0;
      setTitleRec(rec);
      setTitleSeo(Array.isArray(d.seo_keywords) ? d.seo_keywords : []);
      // 기본 선택 = 추천(자동 저장은 안 함 — 사용자가 클릭으로 확정).
      const recTitle = d.candidates?.[rec]?.title;
      if (recTitle) setTitleInput(recTitle);
    } catch (e) {
      setTitleGenErr(e instanceof Error ? e.message : "제목 생성 실패");
    } finally {
      setTitleGenBusy(false);
    }
  }

  // 후보 제목을 프로젝트 제목으로 적용(저장). 이후 제목 클릭으로 수동 수정 가능.
  async function applyTitle(t: string) {
    const v = t.trim();
    if (!v || v === project.title) return;
    try {
      await call("/api/project/title", { projectId: project.id, title: v });
      setProject((p) => ({ ...p, title: v }));
      setTitleInput(v);
    } catch (e) {
      setError(e instanceof Error ? e.message : "제목 저장 실패");
    }
  }

  // 후보 제목을 클립보드로 복사(유튜브 제목란 등에 붙여넣기용).
  async function copyTitle(t: string, i: number) {
    try {
      await navigator.clipboard.writeText(t);
      setCopiedTitleIdx(i);
      setTimeout(() => setCopiedTitleIdx((cur) => (cur === i ? null : cur)), 1500);
    } catch {
      /* 클립보드 불가 무시 */
    }
  }

  // 실제 승인(2단계 진행) — 검수 게이트를 통과/우회한 뒤 호출.
  async function doApprove() {
    setBusy("approve-script");
    await flushScenes(); // 미저장 편집(수정안 반영 포함) 저장 후 승인
    try {
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
      void genTitles(); // 확정 직후 제목 후보 자동 생성(실패해도 확정은 유지)
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setBusy(null);
    }
  }

  function closeReview() {
    setReviewStage(null);
    setReviewData(null);
  }
  // 모달만 닫고 진단은 남긴다 — 자리 비웠다 오거나 리로드해도 '결과 다시 보기'로 복원되게.
  function hideReviewModal() {
    setReviewStage(null);
  }
  function logReviewOutcome(consented: boolean, adopted: "all" | "partial" | "manual" | "none") {
    void fetch("/api/script/review", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectId: project.id, outcome: { consented, adopted } }),
    }).catch(() => {});
  }

  // 별도 구조 검수 — 승인과 분리. 원할 때 돌려 진단·수정안을 미리 보고 고친다(승인 안 함).
  // 통과면 배지만, 위반이면 동의 모달. 사용자가 만족하면 그때 별도로 승인 버튼을 누른다.
  async function runReview() {
    setError(null);
    setReviewErr("");
    setReviewPassed(false);
    await flushScenes(); // 검수 전 최신 대본 저장
    setReviewBusy(true);
    try {
      const r = await fetch("/api/script/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.ok || !d.review) throw new Error(d.error || "검수 실패");
      const review = d.review as ScriptReviewResult;
      if (review.pass) {
        setReviewPassed(true); // 통과 배지만 — 승인은 사용자가 별도로.
      } else {
        setReviewData(review);
        setSelectedRev(new Set(review.revisedScenes.filter((s) => s.changed).map((s) => s.scene)));
        setReviewStage("consent");
      }
    } catch (e) {
      setReviewErr(e instanceof Error ? e.message : "대본 다듬기 실패");
    } finally {
      setReviewBusy(false);
    }
  }

  // "그대로 둘게요/닫기" — 모달만 닫음. 원문 유지(승인 안 함, 진단만 기록·진단은 남김).
  function dismissReview() {
    logReviewOutcome(false, "none");
    hideReviewModal();
  }

  // 선택한 수정안을 씬 나레이션에 반영·저장(⑧ 마무리는 잠금). 승인은 안 함 — 다시 검수·수정 가능.
  async function applyRevisions() {
    if (!reviewData) return;
    const lastIdx = scenesRef.current.length - 1;
    const changed = reviewData.revisedScenes.filter((s) => s.changed && s.revised.trim());
    const revById = new Map(changed.map((s) => [s.scene, s.revised]));
    const newScenes = scenesRef.current.map((s, idx) => {
      const num = idx + 1;
      if (idx !== lastIdx && selectedRev.has(num) && revById.has(num)) {
        return { ...s, narration: revById.get(num) as string };
      }
      return s;
    });
    try {
      const r = await fetch("/api/script/scenes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: project.id, scenes: newScenes }),
      });
      const data = await r.json();
      if (r.ok && data.ok) {
        const saved = data.scenes as Scene[];
        setProject((p) => ({ ...p, scenes: saved }));
        setScenes(saved.map(toEdit));
        setDirty(false);
      }
    } catch {
      /* 저장 실패해도 doApprove 의 flush 가 재시도 */
    }
    const adoptedCount = [...selectedRev].filter((n) => revById.has(n)).length;
    logReviewOutcome(true, adoptedCount === changed.length ? "all" : "partial");
    closeReview();
    setReviewPassed(false); // 대본이 바뀌었으니 통과 배지 내림 — 다시 검수하도록 유도
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

  // 1단계 소스 대화: 요청대로 소스 자료를 다듬는다(강조·조합·톤/길이). 서버가 material 갱신.
  async function sendSourceChat() {
    const msg = sourceChatInput.trim();
    if (!msg || busy !== null) return;
    setError(null);
    setBusy("source-chat");
    try {
      const data = await call("/api/stepchat", {
        projectId: project.id,
        step: "source",
        userMessage: msg,
      });
      setSourceChat(data.chat as typeof sourceChat);
      setProject((p) => ({
        ...p,
        steps: {
          ...p.steps,
          source: {
            ...p.steps.source,
            params: { ...p.steps.source.params, material: data.material },
          },
        },
      }));
      setSourceChatInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "소스 대화 실패");
    } finally {
      setBusy(null);
    }
  }

  // 2단계 스크립트 대화: 씬 나레이션을 대화로 수정. 서버가 새 씬 배열을 돌려주면 반영.
  async function sendScriptChat() {
    const msg = scriptChatInput.trim();
    if (!msg || busy !== null) return;
    setError(null);
    setBusy("script-chat");
    try {
      await flushScenes(); // 미저장 나레이션 편집을 먼저 서버에 반영(대화가 최신 기준으로)
      const data = await call("/api/stepchat", {
        projectId: project.id,
        step: "script",
        userMessage: msg,
      });
      applySavedScenes(data.scenes as Scene[]); // project.scenes + 편집 버퍼 동기화
      setScriptChat(data.chat as typeof scriptChat);
      setScriptChatInput("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "스크립트 대화 실패");
    } finally {
      setBusy(null);
    }
  }

  // 스크립트 전체 복사 — 1씬~마지막 씬 나레이션을 번호 붙여 클립보드로. 편집 버퍼(scenes)
  // 기준이라 화면에 보이는(미저장 편집 포함) 그대로 복사된다. 클로드 등에서 검토·다듬기 용.
  async function copyScript() {
    const txt = scenes.map((s, i) => `${i + 1}. ${(s.narration ?? "").trim()}`).join("\n\n");
    try {
      await navigator.clipboard.writeText(txt);
      setCopiedScript(true);
      setTimeout(() => setCopiedScript(false), 1500);
    } catch {
      setError("복사 실패 — 브라우저 클립보드 권한을 확인하거나 스크립트를 직접 선택해 복사해주세요.");
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
      !!s.skipped ||
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
      motionScale: motionScale[sceneIndex] ?? defaultMotionScale,
      videoCommonPrompt: videoCommonPrompt.trim() || undefined,
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

  // 카메라 워크 프리셋 선택 → 그 씬 모션 프롬프트(영문)를 프리셋 문구로 채운다.
  // 카메라 프리셋 세트 — 연애 클리셰 모드는 로맨스 MV 세트, 그 외는 기본(잔잔) 세트.
  const cameraMoves: readonly (readonly [string, string, string])[] =
    project.mode === "cliche" ? CLICHE_CAMERA_MOVES : CAMERA_MOVES;

  function applyCameraMove(sceneIndex: number, moveId: string) {
    const move = cameraMoves.find((m) => m[0] === moveId);
    if (!move) return;
    setCameraMove((prev) => ({ ...prev, [sceneIndex]: moveId }));
    patchScene(sceneIndex, { motion: move[2] }); // 버퍼 갱신 + 자동저장
  }

  // 스타일 칩 선택을 씬 이미지 프롬프트 끝의 [스타일: …] 로 반영(기존 꼬리는 교체).
  function applyImgChips(sceneIndex: number, chips: Record<string, string>) {
    const frags: string[] = [];
    for (const g of IMG_CHIP_GROUPS) {
      const sel = chips[g.key];
      if (!sel) continue;
      const chip = g.chips.find((c) => c[0] === sel);
      if (chip) frags.push(chip[2]);
    }
    const directive = frags.join(", ");
    const base = (scenes[sceneIndex]?.imagePrompt ?? "")
      .replace(/\s*\[스타일:[^\]]*\]\s*$/, "")
      .trimEnd();
    const next = directive ? `${base}${base ? "\n" : ""}[스타일: ${directive}]` : base;
    patchScene(sceneIndex, { imagePrompt: next });
  }
  // 칩 토글 — 그룹 내에선 하나만(다시 누르면 해제, 다른 칩 누르면 교체). 그룹 간엔 조합.
  function toggleImgChip(sceneIndex: number, groupKey: string, chipId: string) {
    const cur = { ...(imgChips[sceneIndex] ?? {}) };
    if (cur[groupKey] === chipId) delete cur[groupKey];
    else cur[groupKey] = chipId;
    setImgChips((prev) => ({ ...prev, [sceneIndex]: cur }));
    applyImgChips(sceneIndex, cur);
  }

  async function generateVideo(sceneIndex: number) {
    setError(null);
    setBusy(`video-${sceneIndex}`);
    setActiveVideo(sceneIndex);
    try {
      await flushScenes(); // 방금 고른 카메라 워크/모션을 먼저 저장(서버가 scene.motion 으로 읽음)
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
      await flushScenes(); // 미저장 모션(카메라 워크 등) 먼저 저장
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
    await flushScenes(); // 미저장 모션(카메라 워크 등) 먼저 저장
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
    setVoiceBusy("save-tts");
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
      setVoiceBusy(null);
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
    setVoiceBusy(`audio-${sceneIndex}`);
    try {
      await generateOneAudio(sceneIndex);
    } catch (e) {
      setError(e instanceof Error ? e.message : "음성 생성 실패");
    } finally {
      setVoiceBusy(null);
    }
  }

  // 녹음 저장(/api/audio/record)이 끝나 받은 URL 을 그 씬 음성으로 반영 — TTS 생성과 동일.
  function applyRecordedAudio(sceneIndex: number, url: string) {
    setProject((p) => {
      const scenes = p.scenes.map((s, i) =>
        i === sceneIndex ? { ...s, audioUrl: url, status: "generated" as const } : s
      );
      const allDone = scenes.every((s) => s.skipped || s.mood || !!s.audioUrl);
      return {
        ...p,
        scenes,
        steps: {
          ...p.steps,
          voiceover: {
            ...p.steps.voiceover,
            status: (allDone ? "generated" : "generating") as "generated" | "generating",
          },
        },
      };
    });
    bumpMutation(); // 진행 중이던 /state 동기화가 방금 녹음분을 덮지 않도록
  }

  // 음성 없는 씬들을 순차 생성(씬끼리는 순차 — 같은 음성 트랙 경합 방지).
  // 시각(이미지·영상) 작업과는 병렬 가능(voiceBusy 레인 + 서버 재읽기-머지).
  async function generateAllAudio(all = false) {
    await flushScenes();
    if (ttsDirty) await saveTtsScripts();
    setError(null);
    setVoiceBusy("audio-all");
    try {
      for (let i = 0; i < project.scenes.length; i++) {
        if (project.scenes[i].skipped) continue; // 건너뛴 씬 제외
        if (project.scenes[i].mood) continue; // 분위기 씬(무대사) 제외
        if (!all && project.scenes[i].audioUrl) continue;
        await generateOneAudio(i);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "음성 생성 실패");
    } finally {
      setVoiceBusy(null);
    }
  }

  async function approveVoiceover() {
    setError(null);
    setVoiceBusy("approve-voiceover");
    try {
      await call("/api/step/approve", { projectId: project.id, step: "voiceover" });
      setProject((p) => ({
        ...p,
        steps: { ...p.steps, voiceover: { ...p.steps.voiceover, status: "approved" } },
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "승인 실패");
    } finally {
      setVoiceBusy(null);
    }
  }

  const fieldCls =
    "w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-accent";

  return (
    <>
      <main className="px-4 py-8 pb-24 md:max-w-2xl md:mx-auto">
      {editingTitle ? (
        <input
          autoFocus
          value={titleInput}
          onChange={(e) => setTitleInput(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              saveTitle();
            } else if (e.key === "Escape") {
              setTitleInput(project.title);
              setEditingTitle(false);
            }
          }}
          maxLength={200}
          className="w-full rounded-lg border border-accent bg-white dark:bg-zinc-950 px-2 py-1 text-lg font-semibold tracking-tight outline-none"
        />
      ) : (
        <h1
          className="text-lg font-semibold tracking-tight cursor-text hover:opacity-70"
          title="클릭해서 제목 수정"
          onClick={() => {
            setTitleInput(project.title);
            setEditingTitle(true);
          }}
        >
          {project.title}{" "}
          <span className="align-middle text-xs font-normal text-zinc-400">✎</span>
        </h1>
      )}
      {project.longformId && (
        <a
          href={`/project/${project.longformId}`}
          className="mt-1 inline-block text-xs font-medium text-accent hover:underline"
        >
          ← 롱폼으로 돌아가기
        </a>
      )}
      <p className="mt-1 text-xs text-zinc-500">project: {project.id}</p>

      {/* 제목 자동 추천(뉴스) — 확정 대본 기반 후보 3개. 실패해도 확정은 진행. */}
      {project.mode !== "cliche" && (titleCands || titleGenBusy || titleGenErr) && (
        <div id="title-panel" className="mt-3 rounded-xl border border-accent/40 bg-accent/5 p-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">✨ 추천 제목</h2>
            <button
              onClick={genTitles}
              disabled={titleGenBusy}
              className="shrink-0 text-xs rounded-lg border border-accent px-3 py-1.5 text-accent hover:bg-accent/10 disabled:opacity-40"
            >
              {titleGenBusy ? "생성 중…" : "제목 다시 생성"}
            </button>
          </div>
          {titleGenErr && (
            <p className="mt-2 text-[11px] text-red-600">{titleGenErr} — 확정은 그대로 진행됩니다.</p>
          )}
          {titleCands && titleCands.length > 0 && (
            <>
              <ul className="mt-2 grid gap-2">
                {titleCands.map((c, i) => {
                  const selected = project.title === c.title;
                  return (
                    <li
                      key={i}
                      className={`rounded-lg border p-2 ${
                        selected ? "border-accent bg-accent/10" : "border-zinc-200 dark:border-zinc-800"
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            {i === titleRec && (
                              <span className="shrink-0 rounded bg-accent px-1 py-0.5 text-[9px] font-bold text-white">
                                추천
                              </span>
                            )}
                            <span className="text-sm font-medium">{c.title}</span>
                          </div>
                          <div className="mt-0.5 text-[10px] text-zinc-500">
                            {c.structure ? `[${c.structure}] ` : ""}
                            {c.rationale}
                            {c.banned && c.banned.length > 0 && (
                              <span className="text-red-500"> · ⚠ {c.banned.join(", ")}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-1">
                          <button
                            type="button"
                            onClick={() => copyTitle(c.title, i)}
                            className="rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                          >
                            {copiedTitleIdx === i ? "✓ 복사됨" : "📋 복사"}
                          </button>
                          <button
                            type="button"
                            onClick={() => applyTitle(c.title)}
                            className={`rounded-md px-2 py-0.5 text-[11px] font-medium ${
                              selected
                                ? "bg-accent/20 text-accent"
                                : "bg-accent text-white hover:bg-accent-strong"
                            }`}
                          >
                            {selected ? "✓ 적용됨" : "적용"}
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[10px] text-zinc-400">
                [적용]으로 프로젝트 제목 지정, [📋 복사]로 클립보드에 복사(붙여넣기용). 상단 제목 클릭으로 직접 수정.
              </p>
              {titleSeo.length > 0 && (
                <p className="mt-1 text-[10px] text-zinc-500">
                  <span className="font-semibold">설명란 키워드:</span> {titleSeo.join(" · ")}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* 대본 구조 검수 — 별도 버튼이 띄우는 진단·동의 모달(위반 시). 채택해도 승인은 안 함. */}
      {reviewStage && reviewData && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-3"
          onClick={hideReviewModal}
        >
          <div
            className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-4 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold">✍️ 대본 다듬기 (열린 고리)</h3>
            <p className="mt-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-300">
              {reviewData.diagnosisSummary}
            </p>
            {reviewData.violations.length > 0 && (
              <ul className="mt-2 grid list-disc gap-0.5 pl-4 text-[11px] text-red-600">
                {reviewData.violations.map((v, i) => (
                  <li key={i}>{v}</li>
                ))}
              </ul>
            )}
            {reviewStage === "consent" ? (
              <>
                <p className="mt-3 text-sm font-medium">{reviewData.consentQuestion}</p>
                <p className="mt-1 text-[11px] text-zinc-400">동의하기 전엔 원문을 바꾸지 않아요.</p>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setReviewStage("revise")}
                    className="flex-1 rounded-lg bg-accent hover:bg-accent-strong py-2 text-sm font-medium text-white"
                  >
                    수정안 볼게요
                  </button>
                  <button
                    onClick={dismissReview}
                    className="flex-1 rounded-lg border border-zinc-300 dark:border-zinc-700 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    그대로 둘게요
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mt-3 text-xs font-semibold">수정안 (원문 → 수정) · 채택할 씬 선택</p>
                <ul className="mt-1 grid gap-2">
                  {reviewData.revisedScenes
                    .filter((s) => s.changed)
                    .map((s) => {
                      const locked = s.scene >= scenesRef.current.length; // ⑧ 마무리(마지막 씬) 잠금
                      return (
                        <li
                          key={s.scene}
                          className={`rounded-lg border p-2 ${locked ? "opacity-50 border-zinc-200 dark:border-zinc-800" : "border-zinc-200 dark:border-zinc-800"}`}
                        >
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              disabled={locked}
                              checked={!locked && selectedRev.has(s.scene)}
                              onChange={(e) =>
                                setSelectedRev((prev) => {
                                  const n = new Set(prev);
                                  if (e.target.checked) n.add(s.scene);
                                  else n.delete(s.scene);
                                  return n;
                                })
                              }
                              className="mt-0.5"
                            />
                            <div className="min-w-0 flex-1 text-[11px]">
                              <p className="font-semibold text-accent">
                                씬 {s.scene}
                                {locked ? " (마무리·잠금)" : ""}
                              </p>
                              <p className="mt-0.5 text-zinc-400 line-through">{s.original}</p>
                              <p className="mt-0.5 text-zinc-800 dark:text-zinc-100">{s.revised}</p>
                              {s.reason && <p className="mt-0.5 text-[10px] text-zinc-500">↳ {s.reason}</p>}
                            </div>
                          </label>
                        </li>
                      );
                    })}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    onClick={applyRevisions}
                    className="flex-1 rounded-lg bg-accent hover:bg-accent-strong py-2 text-sm font-medium text-white"
                  >
                    선택 채택 (대본에 반영)
                  </button>
                  <button
                    onClick={() => {
                      logReviewOutcome(true, "manual");
                      hideReviewModal();
                    }}
                    className="rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-2 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  >
                    직접 수정
                  </button>
                  <button
                    onClick={dismissReview}
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
            <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-zinc-50 dark:bg-zinc-900 p-2.5 text-zinc-600 dark:text-zinc-400">
              {material.body}
            </p>
          </div>
        )}
        {/* 소스 대화 — 승인 전 소스를 대화로 다듬기/조합 (양질 모델) */}
        {material && !sourceApproved && (
          <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
            <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">소스 다듬기 (AI 대화)</p>
            <p className="mt-0.5 text-[11px] text-zinc-400">
              예: “이 부분을 강조해줘”, “두 소식을 하나로 합쳐줘”, “더 짧고 쉽게”, “핵심 수치만 남겨줘”. 반영되면 위 본문이 바뀝니다.
            </p>
            {sourceChat.length > 0 && (
              <ul className="mt-2 grid gap-1.5 max-h-48 overflow-y-auto">
                {sourceChat.map((t, i) => (
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
                value={sourceChatInput}
                onChange={(e) => setSourceChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendSourceChat();
                  }
                }}
                placeholder="소스 수정 요청…"
                disabled={busy !== null}
                className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
              />
              <button
                type="button"
                onClick={sendSourceChat}
                disabled={busy !== null || !sourceChatInput.trim()}
                className="shrink-0 rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium px-4"
              >
                {busy === "source-chat" ? <Busy>…</Busy> : "보내기"}
              </button>
            </div>
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
                  id={`script-scene-${i}`}
                  className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3 grid gap-2 scroll-mt-4"
                >
                  <div className="flex items-center justify-between text-xs text-zinc-500">
                    <span className="font-medium">
                      씬 {i + 1}
                      {project.scenes[i]?.mood && <span className="ml-1 text-pink-500">💫 분위기 씬</span>}
                    </span>
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
                    {project.scenes[i]?.mood ? (
                      <span className="text-[11px] text-pink-500">
                        💫 분위기 묘사 — 영상에 안 나가요(더빙·자막 없음). 이미지·모션 생성
                        참고용이라 비워도 됩니다.
                      </span>
                    ) : (
                      <span className="text-[11px] text-zinc-500">나레이션</span>
                    )}
                    <AutoTextarea
                      inputRef={(el) => {
                        narrRefs.current[i] = el;
                      }}
                      value={sc.narration}
                      onChange={(e) => patchScene(i, { narration: e.target.value })}
                      minRows={2}
                      maxRows={6}
                      className={fieldCls}
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onMouseDown={(ev) => ev.preventDefault()}
                      onClick={() => wrapEmphasis(i)}
                      className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                    >
                      ✦ 강조
                    </button>
                    <CaptionControls
                      captionStyle={project.scenes[i]?.captionStyle}
                      onStyle={(id) => setCaptionStyle(i, id)}
                    />
                  </div>
                  {/* [cliche] 감정 연기 칩 — 그 씬 대사의 과장 연기(음성에 오디오 태그로 반영).
                      감정 태그는 ElevenLabs 전용 — Typecast 목소리로 더빙될 씬에선 잠근다. */}
                  {project.mode === "cliche" &&
                    (isTypecastVoiceId(sceneVoiceId(i)) ? (
                      <p className="text-[10px] text-zinc-400">
                        감정 연기는 <span className="font-medium">ElevenLabs 목소리 전용</span>이에요 — 이
                        씬은 Typecast 목소리로 더빙되어 감정 태그가 적용되지 않아요. 감정이 필요하면
                        출연진에서 ElevenLabs 목소리를 골라주세요.
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="mr-1 text-[10px] text-zinc-400">감정</span>
                        {EMOTIONS.map((em) => {
                          const active = project.scenes[i]?.emotion === em.id;
                          return (
                            <button
                              key={em.id}
                              type="button"
                              onClick={() => setEmotion(i, active ? "" : em.id)}
                              className={
                                "rounded-md px-2 py-0.5 text-[11px] border transition-colors " +
                                (active
                                  ? "border-pink-500 bg-pink-50 text-pink-700 dark:bg-pink-950/50 dark:text-pink-300 font-medium"
                                  : "border-zinc-300 dark:border-zinc-700 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-900")
                              }
                            >
                              {em.label}
                            </button>
                          );
                        })}
                        <span className="text-[10px] text-zinc-400">(ElevenLabs 전용)</span>
                      </div>
                    ))}
                  <p className="text-[10px] text-zinc-400">
                    길이 ~{estimateDuration(stripMarks(sc.narration))}초 (글자수 기준 자동). 이미지
                    프롬프트·모션은 3~5단계에서 생성합니다.
                    <br />
                    <span className="text-zinc-500">✦ 강조</span> — 강조할 부분을 드래그로 선택하고 누르세요
                    (조사는 빼고 원하는 만큼만 선택). 나레이션에 직접
                    <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">[[크게 강조할 말]]</code>
                    처럼 감싸도 됩니다(음성엔 영향 없음).
                    <br />
                    <span className="text-zinc-500">⏎ 자막을 끊고 싶은 곳에서 줄바꿈(Enter)</span>{" "}
                    하면 그 자리에서 자막이 나뉩니다(음성엔 영향 없음).
                  </p>
                  <div className="mt-1 flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => insertSceneAt(i)}
                      disabled={busy !== null}
                      className="text-[11px] text-accent hover:underline disabled:opacity-40"
                    >
                      ＋ 아래에 씬 추가
                    </button>
                    {project.mode === "cliche" && (
                      <button
                        type="button"
                        onClick={() => insertSceneAt(i, true)}
                        disabled={busy !== null}
                        title="대사·자막 없이 영상+효과음만 나가는 감성 인서트 (비 오는 창밖, 노을 등)"
                        className="text-[11px] text-pink-500 hover:underline disabled:opacity-40"
                      >
                        💫 분위기 씬 추가
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ol>

            {/* 새 씬 컴포저 — 나레이션만 입력하면 프롬프트·모션·길이를 AI가 채운다. */}
            {composerOpen && (
              <div className="mt-3 rounded-xl border border-dashed border-accent/60 p-3 grid gap-2">
                <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                  새 씬 — 나레이션 입력 후 Enter (길이는 자동, 프롬프트·모션은 3~5단계에서)
                </span>
                <AutoTextarea
                  value={newNarration}
                  onChange={(e) => setNewNarration(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      addSceneFromNarration();
                    }
                  }}
                  minRows={2}
                  maxRows={6}
                  autoFocus
                  placeholder="예: 정부가 새 정책을 발표했다.  (Enter=추가, Shift+Enter=줄바꿈)"
                  className={fieldCls}
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

            {/* 스크립트 대화 — 대화로 씬 나레이션 수정(강조·분할/병합·추가/삭제·톤) */}
            <div className="mt-4 rounded-xl border border-zinc-200 dark:border-zinc-800 p-3">
              <p className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">스크립트 다듬기 (AI 대화)</p>
              <p className="mt-0.5 text-[11px] text-zinc-400">
                예: “3번 씬을 더 짧게”, “2·3번을 하나로 합쳐줘”, “도입을 더 강한 훅으로”, “마지막에 요약 씬 추가”, “전체를 더 쉽게”. 반영되면 위 씬들이 바뀝니다.
              </p>
              {scriptChat.length > 0 && (
                <ul className="mt-2 grid gap-1.5 max-h-48 overflow-y-auto">
                  {scriptChat.map((t, i) => (
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
                  value={scriptChatInput}
                  onChange={(e) => setScriptChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      sendScriptChat();
                    }
                  }}
                  placeholder="스크립트 수정 요청…"
                  disabled={busy !== null}
                  className="flex-1 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
                />
                <button
                  type="button"
                  onClick={sendScriptChat}
                  disabled={busy !== null || !scriptChatInput.trim()}
                  className="shrink-0 rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white text-sm font-medium px-4"
                >
                  {busy === "script-chat" ? <Busy>…</Busy> : "보내기"}
                </button>
              </div>
            </div>

            {/* 승인(다음 단계) + 스크립트 전체 복사. 복사는 1씬~마지막씬 나레이션을 클립보드로
                (클로드 등에서 직접 검토·다듬기 용). */}
            <div className="mt-3 flex flex-col sm:flex-row sm:items-stretch gap-2">
              {!scriptApproved ? (
                <button
                  type="button"
                  onClick={() => doApprove()}
                  disabled={busy !== null || reviewBusy}
                  className="flex-1 rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
                >
                  {busy === "approve-script" ? (
                    <Busy>승인 중…</Busy>
                  ) : (
                    "✓ 스크립트 승인하고 키프레임 단계로 →"
                  )}
                </button>
              ) : (
                <p className="flex-1 self-center text-xs text-accent font-medium">
                  ✓ 스크립트 승인됨 — 아래 키프레임 단계로 진행하세요.
                </p>
              )}
              {project.mode !== "cliche" && !scriptApproved && (
                <button
                  type="button"
                  onClick={() => runReview()}
                  disabled={busy !== null || reviewBusy}
                  title="열린 고리 구조로 대본 다듬기 — 진단·수정안을 미리 보고 고친 뒤 승인하세요 (승인은 안 함)"
                  className="shrink-0 rounded-xl border border-accent px-4 py-3 sm:py-0 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors"
                >
                  {reviewBusy ? "다듬는 중…" : "✍️ 대본 다듬기"}
                </button>
              )}
              {project.mode !== "cliche" && (
                <button
                  type="button"
                  onClick={async () => {
                    await flushScenes(); // 미저장 편집 먼저 반영 후 생성
                    genTitles();
                    // 결과 패널이 페이지 상단에 있어, 눌렀을 때 그리로 스크롤.
                    setTimeout(
                      () =>
                        document
                          .getElementById("title-panel")
                          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
                      80
                    );
                  }}
                  disabled={titleGenBusy}
                  title="확정 대본으로 제목 후보 생성(맨 위 ✨ 추천 제목에 표시)"
                  className="shrink-0 rounded-xl border border-accent px-4 py-3 sm:py-0 text-sm font-medium text-accent hover:bg-accent/10 disabled:opacity-40 transition-colors"
                >
                  {titleGenBusy ? "생성 중…" : "✨ 제목 생성"}
                </button>
              )}
              <button
                type="button"
                onClick={copyScript}
                title="1씬부터 마지막 씬까지 스크립트를 클립보드에 복사 — 클로드 등에 붙여넣어 검토·다듬기"
                className="shrink-0 rounded-xl border border-zinc-300 dark:border-zinc-700 px-4 py-3 sm:py-0 text-sm font-medium hover:bg-zinc-100 dark:hover:bg-zinc-900 transition-colors"
              >
                {copiedScript ? "✓ 복사됨" : "📋 스크립트 복사"}
              </button>
            </div>
            {reviewPassed && !reviewBusy && (
              <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
                ✓ 다듬을 곳 없어요 — 열린 고리 구조 확인됨
              </p>
            )}
            {reviewData && !reviewPassed && reviewStage === null && !reviewBusy && !scriptApproved && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                ✍️ 지난 다듬기에서 고칠 곳을 찾았어요.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRev(
                      new Set(reviewData.revisedScenes.filter((s) => s.changed).map((s) => s.scene))
                    );
                    setReviewStage("consent");
                  }}
                  className="font-medium underline hover:no-underline"
                >
                  결과 다시 보기
                </button>
              </p>
            )}
            {reviewErr && (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                ⚠ 대본 다듬기 실패({reviewErr}).{" "}
                <button type="button" onClick={() => runReview()} className="underline hover:no-underline">
                  다시 실행
                </button>
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
        {scriptApproved && (
          // 비워둘 자리 = 주요 정보·인물 없이 배경/소품만 두는 지점(자막이 들어갈 빈 영역).
          // 키프레임이 구도를 잡으므로 키프레임 생성 전에 여기서 고른다. 자막 위치
          // (sub.position)와 같은 값 — 고른 자리를 키프레임·씬 이미지가 모두 비운다.
          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3">
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">🪟 비워둘 자리</span>
            <select
              value={sub.position}
              onChange={(e) =>
                saveSubtitle({ position: e.target.value as SubtitleSettings["position"] })
              }
              disabled={busy !== null}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-accent disabled:opacity-50"
            >
              {subPositions.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-zinc-400">
              주요 정보·인물 없이 배경·소품만 두는 자리 — 자막이 들어갈 빈 영역이에요. 키프레임·이미지 생성에 반영됩니다(자막 위치와 동일).
            </span>
            <p className="w-full mt-1 text-[11px] font-medium text-accent">
              🖼️ {subtitleContentHint(sub.position)}
            </p>
          </div>
        )}
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
                className={`flex ${longAspect} items-center justify-center rounded-xl border border-dashed border-zinc-300 dark:border-zinc-700 text-zinc-400`}
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
                      className={`w-full ${longAspect} object-cover`}
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
              className={`w-48 ${longAspect} object-cover rounded-xl border-2 border-accent`}
            />
            <button
              type="button"
              onClick={() => convertRealistic(0)}
              disabled={busy !== null}
              title="이 키프레임을 구도 그대로 실사(사진)로 변환 — 이후 씬도 이걸 참조합니다"
              className="mt-1.5 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
            >
              {busy === "convert-0" ? <Busy>실사 변환…</Busy> : "✦ 실사로 변환"}
            </button>
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
              onClick={selectAllImageScenes}
              disabled={busy !== null}
              className="text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={clearSelectedScenes}
              disabled={busy !== null || selectedScenes.size === 0}
              className="text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
            >
              전체 해제
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
                  className={`w-12 ${longAspect} object-cover rounded-lg border border-zinc-200 dark:border-zinc-800 cursor-zoom-in`}
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
                const skipped = !!sc.skipped;
                const sceneBusy =
                  imgUploading ||
                  busy === `scene-${i}` ||
                  (busy === "images-all" && !sc.imageUrl && !skipInBatch(i)) ||
                  (busy === "images-selected" && selectedScenes.has(i) && !skipInBatch(i));
                return (
                  <li
                    key={i}
                    className={`grid grid-cols-[80px_1fr] gap-3 rounded-xl border border-zinc-200 dark:border-zinc-800 p-2.5${skipped ? " opacity-50" : ""}`}
                  >
                    <div className={`flex ${longAspect} items-center justify-center overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900`}>
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
                        <div className="flex items-center gap-1.5 min-w-0">
                          <label className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-500">
                            <input
                              type="checkbox"
                              checked={selectedScenes.has(i)}
                              onChange={() => toggleScene(i)}
                              disabled={busy !== null}
                              className="size-3.5 accent-[var(--color-accent)]"
                            />
                            씬 {i + 1} · {sc.durationSec}s
                            {skipped && <span className="ml-1 text-amber-600">· 건너뜀</span>}
                          </label>
                          {renderReorder(i, 1)}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => toggleSkip(i)}
                            disabled={busy !== null}
                            className="shrink-0 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                          >
                            {skipped ? "복원" : "건너뛰기"}
                          </button>
                          {imgMode !== "upload" && !skipped && (
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
                          {sc.imageUrl && !skipped && (
                            <button
                              type="button"
                              onClick={() => convertRealistic(i)}
                              disabled={busy !== null || uploading !== null}
                              title="이 그림을 구도 그대로 실사(사진)로 변환"
                              className="shrink-0 text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                            >
                              {busy === `convert-${i}` ? <Busy>변환…</Busy> : "실사 변환"}
                            </button>
                          )}
                        </div>
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
                          <span className="text-[10px] text-zinc-400">스타일 칩 (누르면 프롬프트에 반영 · 중복 선택 가능)</span>
                          <div className="flex flex-wrap gap-1">
                            {IMG_CHIP_GROUPS.flatMap((g) =>
                              g.chips.map(([id, label]) => {
                                const on = imgChips[i]?.[g.key] === id;
                                return (
                                  <button
                                    key={g.key + id}
                                    type="button"
                                    onClick={() => toggleImgChip(i, g.key, id)}
                                    disabled={busy !== null}
                                    className={`text-[10px] rounded-md border px-1.5 py-0.5 disabled:opacity-40 ${
                                      on
                                        ? "border-accent bg-accent/10 text-accent"
                                        : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                                    }`}
                                  >
                                    {label}
                                  </button>
                                );
                              })
                            )}
                          </div>
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
          <div className="flex flex-wrap items-center gap-1.5">
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
              onClick={selectAllVideoScenes}
              disabled={!imagesApproved || busy !== null || project.scenes.length === 0}
              className="shrink-0 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
            >
              전체 선택
            </button>
            <button
              type="button"
              onClick={clearSelectedScenes}
              disabled={busy !== null || selectedScenes.size === 0}
              className="shrink-0 text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
            >
              전체 해제
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
        {imagesApproved && (
          <div className="mt-2 grid gap-1">
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              🎬 공통 영상 지시 <span className="font-normal text-zinc-400">(전 씬 공통)</span>
            </span>
            <textarea
              value={videoCommonPrompt}
              onChange={(e) => setVideoCommonPrompt(e.target.value)}
              onBlur={(e) => saveVideoCommonPrompt(e.target.value)}
              disabled={busy !== null}
              rows={2}
              placeholder="예: cinematic film grain, warm color grade, subtle handheld feel (모든 씬 영상에 공통으로 들어갑니다)"
              className={fieldCls + " resize-y"}
            />
            <span className="text-[11px] text-zinc-400">
              모든 씬 영상 생성에 공통으로 붙는 지시예요. 씬별 카메라·모션 뒤, 톤 가이드 앞에 들어갑니다. 비우면 없음.
            </span>
          </div>
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
            <ol ref={videoGridRef} className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3">
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
                    <div className={`relative flex ${longAspect} items-center justify-center overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900`}>
                      {sc.videoUrl ? (
                        // 전부 autoPlay 하면 크롬이 무거워져서, 보이는 "한 줄"만 재생한다.
                        <SceneVideoThumb
                          src={sc.videoUrl}
                          poster={sc.imageUrl}
                          className="h-full w-full object-cover"
                          play={videoActiveRow >= 0 && Math.floor(i / videoCols) === videoActiveRow}
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
                      <div className="flex items-center gap-1.5">
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
                        {renderReorder(i)}
                      </div>
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
                            value={motionScale[i] ?? defaultMotionScale}
                            onChange={(e) =>
                              setMotionScale((m) => ({
                                ...m,
                                [i]: e.target.value as "subtle" | "large",
                              }))
                            }
                            disabled={busy !== null}
                            className="rounded border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-1.5 py-0.5 text-[10px] outline-none focus:border-accent disabled:opacity-50"
                          >
                            {project.mode === "cliche" ? (
                              <>
                                <option value="subtle">잔잔 (감성 드리프트)</option>
                                <option value="large">크게 (MV · 기본)</option>
                              </>
                            ) : (
                              <>
                                <option value="subtle">잔잔 (기본)</option>
                                <option value="large">크게</option>
                              </>
                            )}
                          </select>
                        </div>
                        <span className="text-[10px] text-zinc-400">
                          {project.mode === "cliche"
                            ? "카메라 워크 (로맨스 MV — 고르면 모션 채움)"
                            : "카메라 워크 (고르면 모션 채움 · 인물은 거의 정지)"}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          {cameraMoves.map(([id, label]) => (
                            <button
                              key={id}
                              type="button"
                              onClick={() => applyCameraMove(i, id)}
                              disabled={busy !== null}
                              className={`text-[10px] rounded-md border px-1.5 py-0.5 disabled:opacity-40 ${
                                cameraMove[i] === id
                                  ? "border-accent bg-accent/10 text-accent"
                                  : "border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-900"
                              }`}
                            >
                              {label}
                            </button>
                          ))}
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
            disabled={!keyframeApproved || voiceBusy !== null || project.scenes.length === 0}
            className="shrink-0 text-xs rounded-lg bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-medium px-3 py-1.5"
          >
            {voiceBusy === "audio-all" ? <Busy>생성 중…</Busy> : "빈 씬만 생성"}
          </button>
          <button
            type="button"
            onClick={() => generateAllAudio(true)}
            disabled={!keyframeApproved || voiceBusy !== null || project.scenes.length === 0}
            className="shrink-0 text-xs rounded-lg border border-accent text-accent px-3 py-1.5 hover:bg-accent/10 disabled:opacity-40"
          >
            전체 생성
          </button>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">
          🔊 <span className="font-medium">목소리(보이스오버)</span> — 영상에 깔리는 소리입니다.
          화면 <span className="font-medium">글자(자막)</span>와 별개예요.
        </p>

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

        {/* 목소리 선택(프로젝트당 하나) — 뉴스 모드용. 클리셰는 아래 "출연진"에서 인물별로 정한다. */}
        {project.mode !== "cliche" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-zinc-500">목소리</span>
          <select
            value={voiceId}
            onChange={(e) => saveVoice(e.target.value)}
            disabled={busy !== null}
            className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-accent disabled:opacity-50"
          >
            <option value="">기본 목소리 (env 설정)</option>
            {voices
              .filter((v) => v.provider === ttsProvider)
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.narration ? "★ " : ""}
                  {v.name}
                  {v.note ? ` · ${v.note}` : ""}
                </option>
              ))}
          </select>
          <button
            type="button"
            onClick={() => previewVoice()}
            disabled={previewBusy || busy !== null}
            title="선택한 목소리로 짧은 샘플을 들려줍니다"
            className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
          >
            {previewBusy ? <Busy>듣는 중…</Busy> : "▶ 미리듣기"}
          </button>
          <span className="text-[10px] text-zinc-400">★=내레이션 추천 · 바꾸면 음성 재생성</span>
        </div>
        )}

        {/* [cliche] 출연진 — 인물 이름 + 목소리(+내레이션). 여기서 이름·목소리를 정하고,
            씬마다 누가 말하는지는 아래 씬 카드의 "화자"에서 고른다. */}
        {project.mode === "cliche" && (
          <div className="mt-2 grid gap-1.5 rounded-lg border border-pink-200 dark:border-pink-900/50 bg-pink-50/40 dark:bg-pink-950/20 p-2">
            <span className="text-[11px] font-medium text-pink-700 dark:text-pink-300">
              출연진 — 얼굴 · 이름 · 목소리
            </span>
            {[...new Set([...cast, "내레이션"])].map((m) => {
              const isNarr = m === "내레이션";
              const member = isNarr ? undefined : memberOf(m);
              return (
                <div key={m} className="grid gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    {!isNarr &&
                      (member?.portraitUrl ? (
                        <button
                          type="button"
                          onClick={() => setZoomUrl(member.portraitUrl!)}
                          title="포트레이트 크게 보기"
                          className="shrink-0"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={member.portraitUrl}
                            alt={`${m} 포트레이트`}
                            className="w-8 h-8 rounded-md object-cover object-top border border-pink-200 dark:border-pink-900/50"
                          />
                        </button>
                      ) : (
                        <span
                          className="w-8 h-8 shrink-0 rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-[10px] text-zinc-400"
                          title="아직 포트레이트 없음 — 🎨 얼굴에서 만들기"
                        >
                          {faceBusy === m ? <Spinner /> : "?"}
                        </span>
                      ))}
                    {isNarr ? (
                      <span className="inline-block w-24 shrink-0 text-[11px] text-zinc-500">
                        🎙️ 내레이션
                      </span>
                    ) : (
                      <input
                        defaultValue={m}
                        onBlur={(e) => renameCast(m, e.target.value)}
                        disabled={busy !== null}
                        title="인물 이름 (바꾸면 대사 화자·목소리도 같이 바뀝니다)"
                        className="w-24 shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-pink-500 disabled:opacity-50"
                      />
                    )}
                    {/* 출연진 목소리는 두 엔진 전부 노출 — 합성이 목소리 id(tc_ 프리픽스)로
                        엔진을 판별하므로 인물별로 Typecast·ElevenLabs 를 섞어 써도 된다. */}
                    <select
                      value={castVoices[m] ?? ""}
                      onChange={(e) => saveVoice(e.target.value, m)}
                      disabled={busy !== null}
                      className="min-w-[9rem] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-pink-500 disabled:opacity-50"
                    >
                      <option value="">목소리 선택…</option>
                      <optgroup label="Typecast (한국어 캐릭터)">
                        {voices
                          .filter((v) => v.provider === "typecast")
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.narration ? "★ " : ""}
                              {v.name}
                              {v.note ? ` · ${v.note}` : ""}
                            </option>
                          ))}
                      </optgroup>
                      <optgroup label="ElevenLabs (감정 연기 지원)">
                        {voices
                          .filter((v) => v.provider === "elevenlabs")
                          .map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.narration ? "★ " : ""}
                              {v.name}
                              {v.note ? ` · ${v.note}` : ""}
                            </option>
                          ))}
                      </optgroup>
                    </select>
                    <button
                      type="button"
                      onClick={() => previewVoice(castVoices[m])}
                      disabled={previewBusy || busy !== null}
                      title="이 목소리 미리듣기"
                      className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                    >
                      ▶
                    </button>
                    {!isNarr && (
                      <button
                        type="button"
                        onClick={() => setFaceOpen((o) => ({ ...o, [m]: !o[m] }))}
                        disabled={faceBusy !== null}
                        title="포트레이트(캐릭터 시트) 만들기/다시 만들기 — 키프레임·씬 이미지에 얼굴 참조로 들어갑니다"
                        className="shrink-0 rounded-lg border border-pink-300 dark:border-pink-800 px-2 py-1.5 text-xs text-pink-600 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-950/40 disabled:opacity-40"
                      >
                        🎨 얼굴
                      </button>
                    )}
                  </div>
                  {/* 포트레이트 재편집 — 설명 생성 또는 사진 업로드→웹툰 변환(항상 스타일화). */}
                  {!isNarr && faceOpen[m] && (
                    <div className="ml-10 flex flex-wrap items-center gap-1.5">
                      <input
                        value={faceDesc[m] ?? member?.faceDesc ?? ""}
                        onChange={(e) => setFaceDesc((d) => ({ ...d, [m]: e.target.value }))}
                        placeholder="외모 설명 (예: 은발 단발, 안경, 차가운 인상)"
                        disabled={faceBusy !== null}
                        className="flex-1 min-w-[150px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-xs outline-none focus:border-pink-500 disabled:opacity-50"
                      />
                      <button
                        type="button"
                        onClick={() => genCastPortrait(m)}
                        disabled={faceBusy !== null}
                        className="shrink-0 rounded-lg bg-pink-500 hover:bg-pink-600 disabled:opacity-40 text-white text-xs font-medium px-2.5 py-1"
                      >
                        {faceBusy === m ? <Busy>생성 중…</Busy> : member?.portraitUrl ? "✨ 다시 생성" : "✨ 생성"}
                      </button>
                      <input
                        ref={(el) => {
                          castFaceRefs.current[m] = el;
                        }}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) void uploadCastFace(m, f);
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => castFaceRefs.current[m]?.click()}
                        disabled={faceBusy !== null || uploading !== null}
                        title="실제 사진은 항상 웹툰체로 변환됩니다(실사 복제 불가)"
                        className="shrink-0 rounded-lg border border-zinc-300 dark:border-zinc-700 px-2.5 py-1 text-xs text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                      >
                        📷 사진 → 웹툰
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
            <span className="text-[10px] text-zinc-400">
              이름 옆에서 목소리를 정하면 그 인물 대사가 그 목소리로 더빙됩니다. 🎨 얼굴로 만든
              포트레이트는 이후 키프레임·씬 이미지 생성에 얼굴 참조로 들어갑니다(이미 만든 이미지는
              리롤해야 반영). 씬마다 화자는 아래 씬 카드에서.
            </span>
          </div>
        )}

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
                const audioBusy = voiceBusy === `audio-${i}` || voiceBusy === "audio-all";
                const skipped = !!sc.skipped;
                const moodScene = !!sc.mood; // 분위기 씬 — 대사·더빙·자막 없음(영상+효과음만)
                return (
                  <li
                    key={i}
                    id={`voice-scene-${i}`}
                    className={`min-w-0 rounded-xl bg-zinc-50 dark:bg-zinc-900 p-3 scroll-mt-4${skipped ? " opacity-50" : ""}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 text-[11px] text-zinc-500">씬 {i + 1}</span>
                      {renderReorder(i)}
                      <button
                        type="button"
                        onClick={() => goToScriptScene(i)}
                        title="클릭하면 스크립트 단계로 올라가 이 자막을 수정할 수 있어요 (행갈이 포함)"
                        className="min-w-0 flex-1 truncate text-left text-[11px] text-zinc-500 hover:text-accent hover:underline"
                      >
                        {moodScene ? (
                          <>
                            <span className="text-pink-500">💫 분위기 씬 </span>
                            <span className="text-zinc-400">(더빙·자막 없음) </span>
                            {sc.narration}
                          </>
                        ) : (
                          <>
                            <span className="text-zinc-400">📝 자막 </span>
                            {skipped ? <span className="text-amber-600">건너뜀</span> : sc.narration}
                          </>
                        )}
                        <span className="ml-1 text-zinc-300">✎</span>
                      </button>
                      {moodScene && (
                        <button
                          type="button"
                          onClick={() => toggleMood(i, false)}
                          disabled={voiceBusy !== null}
                          title="분위기 씬을 일반 씬으로 되돌립니다 — 대사를 넣고 더빙·자막을 쓸 수 있게 됩니다"
                          className="shrink-0 text-[11px] rounded-md border border-pink-300 dark:border-pink-800 px-2 py-0.5 text-pink-600 dark:text-pink-300 hover:bg-pink-50 dark:hover:bg-pink-950/40 disabled:opacity-40"
                        >
                          🔊 일반 씬으로
                        </button>
                      )}
                      {!moodScene && (
                        <div className="shrink-0 grid justify-items-end gap-0.5">
                          <div className="flex items-center gap-1">
                            <SceneRecorder
                              projectId={project.id}
                              sceneIndex={i}
                              hasAudio={!!sc.audioUrl}
                              disabled={voiceBusy !== null || skipped}
                              onLocal={(url) => applyRecordedAudio(i, url)}
                              onSaved={(url) => applyRecordedAudio(i, url)}
                              onError={(m) => setError(m)}
                            />
                            <button
                              type="button"
                              onClick={() => generateAudio(i)}
                              disabled={voiceBusy !== null || !sc.narration || skipped}
                              className="text-[11px] rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-0.5 hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                            >
                              {sc.audioUrl ? "리롤" : "음성 생성"}
                            </button>
                          </div>
                          {audioCost[i] && (
                            <span className="text-[11px] text-zinc-400">{audioCost[i]}</span>
                          )}
                        </div>
                      )}
                    </div>
                    {/* [cliche] 대사·내레이션 줄 편집 — 줄마다 화자·텍스트·감정. 줄들을 이어 더빙한다. */}
                    {project.mode === "cliche" && !moodScene && (
                        <div className="mt-1.5 grid gap-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] text-zinc-400">
                              대사·내레이션 (줄마다 화자·감정 지정 — 감정 연기는 ElevenLabs 목소리 전용)
                            </span>
                            <button
                              type="button"
                              onClick={() => toggleMood(i, true)}
                              disabled={voiceBusy !== null}
                              title="이 씬을 무대사 분위기 씬으로 — 더빙·자막 없이 영상+효과음만 나갑니다"
                              className="shrink-0 text-[10px] text-zinc-400 hover:text-pink-500 hover:underline disabled:opacity-40"
                            >
                              💫 분위기 씬으로
                            </button>
                          </div>
                          {sceneLines(i).map((ln, li) => (
                            <div key={li} className="flex flex-wrap items-center gap-1.5">
                              <select
                                value={ln.speaker ?? ""}
                                onChange={(e) => editLine(i, li, { speaker: e.target.value })}
                                disabled={voiceBusy !== null}
                                className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-1.5 py-1 text-[11px] outline-none focus:border-pink-500 disabled:opacity-50"
                              >
                                <option value="">{li === 0 ? "화자 선택" : "▲ 위 화자 따라감"}</option>
                                {[...new Set([...cast, "내레이션", ...(ln.speaker ? [ln.speaker] : [])])].map(
                                  (sp) => (
                                    <option key={sp} value={sp}>
                                      {sp === "내레이션" ? "🎙️내레이션" : sp}
                                    </option>
                                  )
                                )}
                              </select>
                              <input
                                defaultValue={ln.text}
                                onBlur={(e) =>
                                  e.target.value.trim() !== ln.text &&
                                  editLine(i, li, { text: e.target.value })
                                }
                                disabled={voiceBusy !== null}
                                placeholder="대사 / 내레이션"
                                className="min-w-[8rem] flex-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-pink-500 disabled:opacity-50"
                              />
                              {/* 감정 태그는 ElevenLabs 전용 — 이 줄이 Typecast 목소리로
                                  더빙되면 잠금(선택해도 무시되는 걸 명시). */}
                              {isTypecastVoiceId(lineVoiceId(i, li)) ? (
                                <span
                                  title="이 줄은 Typecast 목소리로 더빙돼요 — 감정 연기는 ElevenLabs 목소리 전용입니다. 감정이 필요하면 이 화자에게 ElevenLabs 목소리를 골라주세요."
                                  className="rounded-md border border-zinc-200 dark:border-zinc-800 px-1.5 py-1 text-[11px] text-zinc-400 cursor-help select-none"
                                >
                                  감정 —
                                </span>
                              ) : (
                                <select
                                  value={ln.emotion ?? ""}
                                  onChange={(e) => editLine(i, li, { emotion: e.target.value })}
                                  disabled={voiceBusy !== null}
                                  title="감정 연기 (ElevenLabs 전용)"
                                  className="rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-1.5 py-1 text-[11px] outline-none focus:border-pink-500 disabled:opacity-50"
                                >
                                  <option value="">감정</option>
                                  {EMOTIONS.map((em) => (
                                    <option key={em.id} value={em.id}>
                                      {em.label}
                                    </option>
                                  ))}
                                </select>
                              )}
                              <button
                                type="button"
                                onClick={() => removeLine(i, li)}
                                disabled={voiceBusy !== null}
                                className="shrink-0 rounded px-1 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950 disabled:opacity-40"
                                aria-label="줄 삭제"
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            onClick={() => addLine(i)}
                            disabled={voiceBusy !== null}
                            className="justify-self-start text-[11px] text-pink-600 dark:text-pink-400 hover:underline disabled:opacity-40"
                          >
                            ＋ 줄 추가
                          </button>
                        </div>
                    )}
                    {/* [cliche] 효과음 — 설명 → 생성 → 미리듣기 → 볼륨. 합성 때 목소리 밑에 깔린다. */}
                    {project.mode === "cliche" && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] text-zinc-400">🔊 효과음</span>
                        <input
                          value={sfxText[i] ?? sc.sfx ?? ""}
                          onChange={(e) => setSfxText((p) => ({ ...p, [i]: e.target.value }))}
                          placeholder="예: 빗소리, 천둥, 심장 쿵"
                          disabled={sfxBusy !== null}
                          className="min-w-[9rem] flex-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1 text-[11px] outline-none focus:border-pink-500 disabled:opacity-50"
                        />
                        <button
                          type="button"
                          onClick={() => genSfx(i)}
                          disabled={sfxBusy !== null || !(sfxText[i] ?? sc.sfx ?? "").trim()}
                          className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-900 disabled:opacity-40"
                        >
                          {sfxBusy === i ? <Busy>생성 중…</Busy> : sc.sfxUrl ? "다시 생성" : "생성"}
                        </button>
                        {sc.sfxUrl && (
                          <>
                            <button
                              type="button"
                              onClick={() => playSfx(sc.sfxUrl!)}
                              title="효과음 미리듣기"
                              className="shrink-0 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-[11px] hover:bg-zinc-100 dark:hover:bg-zinc-900"
                            >
                              ▶
                            </button>
                            <div className="inline-flex rounded-md border border-zinc-200 dark:border-zinc-800 p-0.5 text-[10px]">
                              {([["약", 0.2], ["보통", 0.35], ["크게", 0.6]] as const).map(([lbl, v]) => (
                                <button
                                  key={lbl}
                                  type="button"
                                  onClick={() => setSfxVolume(i, v)}
                                  className={`rounded px-1.5 py-0.5 ${Math.abs((sc.sfxVolume ?? 0.35) - v) < 0.01 ? "bg-accent text-white" : "text-zinc-500"}`}
                                >
                                  {lbl}
                                </button>
                              ))}
                            </div>
                            <button
                              type="button"
                              onClick={() => clearSfx(i)}
                              title="효과음 제거"
                              className="shrink-0 rounded px-1 text-[11px] text-red-500 hover:bg-red-50 dark:hover:bg-red-950"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
                    )}
                    {/* 오디오 바는 카드 전체 폭 별도 줄. 네이티브 <audio controls> 는
                        모바일 최소 폭이 viewport 를 넘겨 가로 스크롤을 만들어 커스텀
                        미니 플레이어(MiniAudio)로 대체 — 폭을 완전히 제어. */}
                    {sc.audioUrl ? (
                      <MiniAudio src={sc.audioUrl} className="mt-2" />
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
                    <AutoTextarea
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
                disabled={voiceBusy !== null}
                className="mt-4 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
              >
                {voiceBusy === "approve-voiceover" ? (
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
                  captionStyle={sc.captionStyle}
                  onCaptionStyle={(id) => setCaptionStyle(i, id)}
                  onSaveLines={sc.mood ? undefined : (text) => saveSubtitleLines(i, text)}
                  onReRecord={sc.mood ? undefined : () => goToVoiceScene(i)}
                  format={project.format}
                />
              ) : null
            )}
          </ol>
        </section>
      )}

      {/* 다른 언어판 만들기 — 어느 언어판에서든 현재 언어를 뺀 다른 언어로 새 프로젝트 생성(대칭). */}
      {hasScenes && (
        <section className="mt-4 rounded-2xl border border-zinc-200 dark:border-zinc-800 p-5">
          <h2 className="text-sm font-semibold">🌐 다른 언어판(더빙) 만들기</h2>
          <p className="mt-1 text-[11px] text-zinc-400">
            🔊📝 <span className="font-medium">더빙판</span> = 고른 언어로 <span className="font-medium">목소리·자막을 모두</span> 바꾼
            <span className="font-medium"> 새 프로젝트</span>. 이미지 프롬프트·모션·스타일은 가져오고, 영상·음성은 새 프로젝트에서
            따로 생성해요(라이브러리에 별도 저장). 현재 <span className="font-medium">{composeLangLabel}</span>에서 만들 수 있는 언어:
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {otherLanguages(project.lang).map((L) => (
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
              onBlur={() => saveWatermark(wmText, wmPos, wmCredit)}
              placeholder="예: @내채널 / 출처표기 (비우면 없음)"
              maxLength={60}
              className="flex-1 min-w-[160px] rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
            />
            <select
              value={wmPos}
              onChange={(e) => {
                const p = e.target.value as "tl" | "tr" | "bl" | "br";
                setWmPos(p);
                saveWatermark(wmText, p, wmCredit);
              }}
              className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2 py-1.5 text-xs outline-none focus:border-accent"
            >
              <option value="tl">좌상</option>
              <option value="tr">우상</option>
              <option value="bl">좌하</option>
              <option value="br">우하</option>
            </select>
          </div>
          {/* 제작 크레딧 — 마지막 2씬에만 워터마크 옆에 "제작 : 이름" (1.5배 크기) */}
          <input
            type="text"
            value={wmCredit}
            onChange={(e) => setWmCredit(e.target.value)}
            onBlur={() => saveWatermark(wmText, wmPos, wmCredit)}
            placeholder="제작 크레딧 이름 (예: 홍길동) — 마지막 2씬에만"
            maxLength={60}
            className="mt-1.5 w-full rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-2.5 py-1.5 text-sm outline-none focus:border-accent"
          />
          <p className="mt-1 text-[10px] text-zinc-400">
            입력 후 칸 밖을 누르면 저장됩니다. 워터마크는 모든 씬 모서리에 작게. 제작 크레딧은
            <span className="font-medium"> 마지막 2씬</span>에만 워터마크 위치 옆(하단이면 위, 상단이면 아래)에
            정렬 맞춰 <span className="font-medium">1.5배</span>로 “제작 : 이름” 표시됩니다.
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
                  onClick={() => startCompose()}
                  disabled={busy !== null}
                  className="mt-2 w-full rounded-xl bg-accent hover:bg-accent-strong disabled:opacity-40 text-white font-semibold py-3 transition-colors"
                >
                  {project.finalVideoUrl ? "🎬 다시 합성" : "🎬 최종 합성하기"} (
                  {composeLangLabel})
                </button>
                <button
                  type="button"
                  onClick={() => startCompose(true)}
                  disabled={busy !== null}
                  title="보이스·자막·효과음·워터마크 없이 영상만 이어 붙입니다. 씬 길이는 음성 기준 그대로라 편집기에서 풀버전과 타이밍이 맞아요."
                  className="mt-2 w-full rounded-xl border border-accent text-accent hover:bg-accent/10 disabled:opacity-40 font-medium py-2.5 text-sm transition-colors"
                >
                  🎞️ 영상만 합성 (보이스·자막 제외 — 소재용)
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
          {project.cleanVideoUrl && (
            <div className="mt-3 flex items-center justify-center gap-2">
              <a
                href={`/api/download?projectId=${encodeURIComponent(project.id)}&kind=clean`}
                download
                className="inline-block text-xs rounded-lg border border-zinc-300 dark:border-zinc-700 px-3 py-1.5 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                ⬇ 영상만(클린) 다운로드 — 보이스·자막 없음
              </a>
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
