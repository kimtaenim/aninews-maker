import { NextRequest, NextResponse } from "next/server";
import { extractFromWikipedia } from "@/lib/wikipedia";
import { createProject } from "@/lib/projectStore";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 30;

// 1. source (위키백과) — 위키 주소/표제어 → 공식 API 로 깨끗한 본문 추출 → 프로젝트 생성.
// body: { input, userPrompt?, styleProfileId?, videoModelId?, ttsEnabled? }
export async function POST(req: NextRequest) {
  let body: {
    input?: string;
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

  const input = (body.input ?? "").trim();
  if (!input) {
    return NextResponse.json(
      { ok: false, error: "위키백과 주소나 표제어를 입력해주세요" },
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
    const material = await extractFromWikipedia(input);
    const project = await createProject({
      material,
      styleProfileId,
      videoModelId,
      ttsEnabled: body.ttsEnabled ?? true,
      userPrompt: body.userPrompt,
    });
    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "위키백과 추출 실패" },
      { status: 502 }
    );
  }
}
