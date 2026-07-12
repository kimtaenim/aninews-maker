import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import type { ImageSourceMode, VideoSourceMode } from "@/lib/types";

export const runtime = "nodejs";

// 씬별 소스 설정 + 업로드 산출물 저장(작은 패치 — 무거운 /script/scenes 재구성과 분리).
//   - sceneIndex 있으면: 그 씬의 imageSource/referenceImageUrl/paletteHint/imageUrl/
//     videoSource/videoUrl 중 전달된 것만 갱신.
//   - sceneIndex 없고 keyframeReferenceUrl 있으면: 프로젝트 키프레임 참조 이미지 갱신.
// 빈 문자열("")은 "지움"(undefined)으로 해석.
type Body = {
  projectId?: string;
  sceneIndex?: number;
  imageSource?: ImageSourceMode;
  referenceImageUrl?: string | null;
  paletteHint?: string | null;
  imageUrl?: string | null;
  videoSource?: VideoSourceMode;
  videoUrl?: string | null;
  skipped?: boolean; // 씬 건너뛰기 토글
  captionStyle?: string | null; // 자막 스타일 프리셋 id ("" 또는 null = 기본)
  narration?: string; // 자막 강조([[ ]]) 편집 — 미리보기에서 저장. 음성대본(ttsScript)은 안 건드림.
  emotion?: string | null; // [cliche] 감정 연기 id ("" 또는 null = 없음)
  speaker?: string | null; // [cliche] 대사 화자(인물 이름 또는 "내레이션")
  voiceId?: string | null; // [cliche] 이 씬 전용 목소리 오버라이드 ("" 또는 null = 화자 기본)
  lines?: { text?: unknown; speaker?: unknown; emotion?: unknown }[]; // [cliche] 씬 줄 배열 편집
  keyframeReferenceUrl?: string | null;
};

// 빈 문자열·null·undefined → undefined(지움), 그 외엔 그대로.
const clear = (v: string | null | undefined) => v || undefined;

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // 프로젝트 레벨: 키프레임 참조 이미지
  if (body.sceneIndex === undefined && body.keyframeReferenceUrl !== undefined) {
    project.keyframeReferenceUrl = clear(body.keyframeReferenceUrl);
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: true, keyframeReferenceUrl: project.keyframeReferenceUrl });
  }

  const sceneIndex = body.sceneIndex;
  if (typeof sceneIndex !== "number" || !Number.isInteger(sceneIndex)) {
    return NextResponse.json({ ok: false, error: "sceneIndex 필요" }, { status: 400 });
  }
  if (sceneIndex < 0 || sceneIndex >= project.scenes.length) {
    return NextResponse.json({ ok: false, error: "sceneIndex 범위 밖" }, { status: 422 });
  }

  const scene = { ...project.scenes[sceneIndex] };
  if (body.imageSource !== undefined) scene.imageSource = body.imageSource;
  if (body.referenceImageUrl !== undefined) scene.referenceImageUrl = clear(body.referenceImageUrl);
  if (body.paletteHint !== undefined) scene.paletteHint = clear(body.paletteHint);
  // 업로드한 이미지를 그대로 산출물로 — 곧장 generated.
  if (body.imageUrl !== undefined) {
    scene.imageUrl = clear(body.imageUrl);
    if (scene.imageUrl) scene.status = "generated";
  }
  if (body.skipped !== undefined) scene.skipped = body.skipped || undefined;
  if (body.captionStyle !== undefined) scene.captionStyle = clear(body.captionStyle);
  if (body.emotion !== undefined) scene.emotion = clear(body.emotion);
  if (body.speaker !== undefined) scene.speaker = clear(body.speaker);
  if (body.voiceId !== undefined) scene.voiceId = clear(body.voiceId);
  // [cliche] 줄 배열 편집 — 자막(narration)도 줄들을 이어 동기화.
  if (Array.isArray(body.lines)) {
    const lines = body.lines
      .map((l) => ({
        text: typeof l?.text === "string" ? l.text.trim() : "",
        ...(typeof l?.speaker === "string" && l.speaker.trim() ? { speaker: l.speaker.trim() } : {}),
        ...(typeof l?.emotion === "string" && l.emotion.trim() ? { emotion: l.emotion.trim() } : {}),
      }))
      .filter((l) => l.text);
    scene.lines = lines.length ? lines : undefined;
    if (lines.length) scene.narration = lines.map((l) => l.text).join("\n");
  }
  // 자막 강조 편집(미리보기) — 나레이션 문자열만 갱신. 강조 마커([[ ]])는 발음에 영향이
  // 없으므로 음성대본(ttsScript) 오버라이드는 그대로 둔다. 빈 문자열은 무시(자막 비우기 방지).
  if (typeof body.narration === "string" && body.narration.trim()) {
    scene.narration = body.narration;
  }
  if (body.videoSource !== undefined) scene.videoSource = body.videoSource;
  // 업로드한 영상을 그대로 산출물로 — 진행 중 폴링 잔재(videoJobId) 제거.
  if (body.videoUrl !== undefined) {
    scene.videoUrl = clear(body.videoUrl);
    if (scene.videoUrl) {
      scene.status = "generated";
      scene.videoJobId = undefined;
    }
  }

  project.scenes[sceneIndex] = scene;
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, scene });
}
