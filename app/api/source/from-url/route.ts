import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl } from "@/lib/source";
import { createProject } from "@/lib/projectStore";
import { getStyleProfile } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 30;

// 1. source (URL) — 뉴스 URL 본문 추출 → 프로젝트 생성 → { projectId }
// body: { url, styleProfileId?, videoModelId?, ttsEnabled? }
export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    styleProfileId?: string;
    videoModelId?: string;
    ttsEnabled?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const url = (body.url ?? "").trim();
  if (!url) {
    return NextResponse.json({ ok: false, error: "url 필요" }, { status: 400 });
  }

  const styleProfileId = body.styleProfileId || "2d-cartoon";
  const videoModelId = body.videoModelId || videoModels.default;
  // 잘못된 프로필 id 면 createProject 내부 getStyleProfile 이 던지므로 미리 검증.
  try {
    getStyleProfile(styleProfileId);
  } catch {
    return NextResponse.json(
      { ok: false, error: `style profile not found: ${styleProfileId}` },
      { status: 400 }
    );
  }

  try {
    const material = await extractFromUrl(url);
    const project = await createProject({
      material,
      styleProfileId,
      videoModelId,
      ttsEnabled: body.ttsEnabled ?? false,
    });
    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "fetch 실패" },
      { status: 502 }
    );
  }
}
