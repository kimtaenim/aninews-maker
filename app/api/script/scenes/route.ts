import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { DURATION_MIN, DURATION_MAX } from "@/lib/scenes";
import type { Scene } from "@/lib/types";

export const runtime = "nodejs";

// 사용자가 편집한 씬 배열 저장. body: { projectId, scenes }
// 직접 편집(나레이션·프롬프트·모션·길이·추가/삭제)을 반영. status 는 generated 유지
// (승인은 /api/step/approve 로 별도).
export async function POST(req: NextRequest) {
  let body: { projectId?: string; scenes?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  if (!Array.isArray(body.scenes) || body.scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "scenes 배열 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // 정규화: 필수 텍스트 보장, duration clamp, index 재부여. 이미 생성된 씬의
  // 산출물(imageUrl/videoUrl 등)은 같은 index 면 보존.
  const prev = project.scenes;
  const clampDur = (d: unknown) => {
    const n = Number(d);
    if (!Number.isFinite(n)) return 5;
    return Math.max(DURATION_MIN, Math.min(DURATION_MAX, n));
  };

  const scenes: Scene[] = (body.scenes as Record<string, unknown>[]).map((s, index) => {
    const carry = prev.find((p) => p.index === index);
    return {
      index,
      narration: String(s.narration ?? "").trim(),
      ttsScript: carry?.ttsScript, // 음성 전용 오버라이드는 같은 index 면 보존
      imagePrompt: String(s.imagePrompt ?? "").trim(),
      motion: String(s.motion ?? "").trim(),
      durationSec: clampDur(s.durationSec),
      status: "generated",
      imageUrl: carry?.imageUrl,
      videoUrl: carry?.videoUrl,
      audioUrl: carry?.audioUrl,
      ttsTimestamps: carry?.ttsTimestamps,
    };
  });

  if (scenes.some((s) => !s.narration || !s.imagePrompt || !s.motion)) {
    return NextResponse.json(
      { ok: false, error: "각 씬의 나레이션·이미지 프롬프트·모션은 비울 수 없어요" },
      { status: 422 }
    );
  }

  project.scenes = scenes;
  project.steps.script.status = "generated";
  project.steps.script.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, scenes });
}
