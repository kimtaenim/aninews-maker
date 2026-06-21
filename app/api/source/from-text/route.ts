import { NextRequest, NextResponse } from "next/server";
import { materialFromText, SOURCE_MAX_INPUT_CHARS } from "@/lib/source";
import { createProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 30;

// 1. source (텍스트) — 직접 입력 텍스트 → 프로젝트 생성 → { projectId }
// body: { text, styleProfileId?, videoModelId?, ttsEnabled? }
export async function POST(req: NextRequest) {
  let body: {
    text?: string;
    userPrompt?: string;
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
    return NextResponse.json({ ok: false, error: "text 필요" }, { status: 400 });
  }
  if (text.length > SOURCE_MAX_INPUT_CHARS) {
    return NextResponse.json(
      {
        ok: false,
        error: `텍스트가 너무 길어요 (${text.length}자 / 최대 ${SOURCE_MAX_INPUT_CHARS}자).`,
      },
      { status: 400 }
    );
  }

  const styleProfileId = body.styleProfileId || DEFAULT_STYLE_PROFILE_ID;
  const videoModelId = body.videoModelId || videoModels.default;
  try {
    getStyleProfile(styleProfileId);
  } catch {
    return NextResponse.json(
      { ok: false, error: `style profile not found: ${styleProfileId}` },
      { status: 400 }
    );
  }

  try {
    const material = materialFromText(text);
    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId,
      videoModelId,
      ttsEnabled: body.ttsEnabled ?? true,
      userPrompt: body.userPrompt,
    });
    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
