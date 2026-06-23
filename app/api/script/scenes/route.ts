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

  const normMode = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
    typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;

  const scenes: Scene[] = (body.scenes as Record<string, unknown>[]).map((s, index) => {
    const carry = prev.find((p) => p.index === index);
    // 소스 모드: 편집본 우선, 없으면 기존값 보존(미설정=generate).
    const imageSource =
      normMode(s.imageSource, ["generate", "reference", "upload"] as const) ?? carry?.imageSource;
    const videoSource =
      normMode(s.videoSource, ["generate", "upload"] as const) ?? carry?.videoSource;
    return {
      index,
      narration: String(s.narration ?? "").trim(),
      // 음성 오버라이드 보존 — 단, 그 씬의 나레이션을 그대로 미러링하던 값(=실제로
      // 다르게 지정한 게 아님)이면 비운다. 그래야 나레이션이 바뀌면 음성대본도 따라간다.
      ttsScript:
        carry?.ttsScript && carry.ttsScript !== carry.narration ? carry.ttsScript : undefined,
      imagePrompt: String(s.imagePrompt ?? "").trim(),
      motion: String(s.motion ?? "").trim(),
      durationSec: clampDur(s.durationSec),
      status: "generated",
      imageSource,
      // 참조 이미지/팔레트는 편집본에 있으면 갱신, 없으면 보존(업로드는 별도 엔드포인트로 채움).
      referenceImageUrl:
        typeof s.referenceImageUrl === "string"
          ? s.referenceImageUrl || undefined
          : carry?.referenceImageUrl,
      paletteHint:
        typeof s.paletteHint === "string" ? s.paletteHint.trim() || undefined : carry?.paletteHint,
      videoSource,
      imageUrl: carry?.imageUrl,
      videoUrl: carry?.videoUrl,
      audioUrl: carry?.audioUrl,
      ttsTimestamps: carry?.ttsTimestamps,
    };
  });

  // 나레이션만 필수. 이미지 프롬프트(3·4단계)·모션(5단계)은 이후 단계에서 생성하므로
  // 2단계 저장 시점엔 비어 있는 게 정상이다(생성 버튼이 비었을 때 막아준다).
  const invalid = scenes.find((s) => !s.narration);
  if (invalid) {
    return NextResponse.json(
      { ok: false, error: `씬${invalid.index + 1}: 나레이션은 비울 수 없어요` },
      { status: 422 }
    );
  }

  project.scenes = scenes;
  // 승인 상태는 보존한다 — 편집 저장(나레이션·프롬프트 수정)이 승인을 풀면 키프레임
  // 단계가 "스크립트 먼저 승인"으로 막힌다. 스크립트를 새로 만들 때만(/api/script)
  // generated 로 되돌린다.
  project.steps.script.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({ ok: true, scenes });
}
