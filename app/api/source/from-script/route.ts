import { NextRequest, NextResponse } from "next/server";
import { materialFromText, SOURCE_MAX_INPUT_CHARS } from "@/lib/source";
import { createProject, saveProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import { estimateDuration } from "@/lib/scenes";
import type { Scene } from "@/lib/types";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 30;

// 완성된 스크립트를 바로 입력 — 소스→AI 스크립트 생성 단계를 건너뛰고 붙여넣은 글을 씬으로.
// body: { text, styleProfileId?, videoModelId?, ttsEnabled? }
// 씬 분할: 빈 줄로 나뉜 문단 = 한 씬. 빈 줄이 없으면 한 줄 = 한 씬. (문단 안 줄바꿈은 자막 경계로 보존)
// source 단계는 승인(검수 불필요 — 사용자 스크립트), script 단계는 generated(2단계에서 확인·승인).
export async function POST(req: NextRequest) {
  let body: {
    text?: string;
    styleProfileId?: string;
    videoModelId?: string;
    ttsEnabled?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const text = (body.text ?? "").trim();
  if (!text) {
    return NextResponse.json({ ok: false, error: "스크립트 텍스트가 필요해요" }, { status: 400 });
  }
  if (text.length > SOURCE_MAX_INPUT_CHARS) {
    return NextResponse.json(
      { ok: false, error: `스크립트가 너무 길어요 (${text.length}자 / 최대 ${SOURCE_MAX_INPUT_CHARS}자).` },
      { status: 400 }
    );
  }

  // 씬 분할: 빈 줄(문단) 우선, 없으면 한 줄씩. 각 조각의 앞뒤 공백만 정리(문단 안 줄바꿈=자막 경계 유지).
  const byBlank = text.split(/\n[ \t]*\n+/).map((b) => b.trim()).filter(Boolean);
  const chunks = byBlank.length > 1 ? byBlank : text.split(/\r?\n+/).map((s) => s.trim()).filter(Boolean);
  if (chunks.length === 0) {
    return NextResponse.json({ ok: false, error: "씬으로 나눌 내용이 없어요" }, { status: 400 });
  }

  const styleProfileId = body.styleProfileId || DEFAULT_STYLE_PROFILE_ID;
  const videoModelId = body.videoModelId || videoModels.default;
  try {
    getStyleProfile(styleProfileId);
  } catch {
    return NextResponse.json({ ok: false, error: `style profile not found: ${styleProfileId}` }, { status: 400 });
  }

  try {
    const material = { ...materialFromText(text), sourceName: "직접 입력 스크립트" };
    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId,
      videoModelId,
      ttsEnabled: body.ttsEnabled ?? true,
    });

    // 붙여넣은 스크립트를 씬으로 채운다. 이미지 프롬프트·모션은 이후 단계에서 생성.
    const scenes: Scene[] = chunks.map((narration, index) => ({
      index,
      narration,
      imagePrompt: "",
      motion: "",
      durationSec: estimateDuration(narration),
      status: "generated",
    }));
    project.scenes = scenes;
    // 소스는 승인(사용자 스크립트라 검수 불필요), 스크립트는 generated(2단계에서 확인·승인).
    const now = Date.now();
    project.steps.source.status = "approved";
    project.steps.source.updatedAt = now;
    project.steps.script.status = "generated";
    project.steps.script.updatedAt = now;
    project.updatedAt = now;
    await saveProject(project);

    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
