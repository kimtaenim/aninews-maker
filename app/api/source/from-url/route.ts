import { NextRequest, NextResponse } from "next/server";
import { extractFromUrl, type SourceMaterial } from "@/lib/source";
import { mergeSources } from "@/lib/mergeSources";
import { createProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 60;

// 1. source (URL) — URL 1개 또는 여러 개의 본문을 추출, 여러 개면 1개 주제로 종합 →
// 프로젝트 생성. RSS에서 고른 기사 링크들도 이 라우트(urls[])로 보낸다.
// body: { url? | urls?[], userPrompt?, styleProfileId?, videoModelId?, ttsEnabled? }
export async function POST(req: NextRequest) {
  let body: {
    url?: string;
    urls?: string[];
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

  const raw = Array.isArray(body.urls) ? body.urls : body.url ? [body.url] : [];
  const urls = Array.from(
    new Set(raw.map((u) => (u ?? "").trim()).filter(Boolean))
  ).slice(0, 20);
  if (urls.length === 0) {
    return NextResponse.json({ ok: false, error: "url 필요" }, { status: 400 });
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
    const settled = await Promise.allSettled(urls.map((u) => extractFromUrl(u)));
    const materials: SourceMaterial[] = [];
    const errors: string[] = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") materials.push(s.value);
      else {
        const host = (() => {
          try {
            return new URL(urls[i]).hostname;
          } catch {
            return urls[i].slice(0, 30);
          }
        })();
        errors.push(`${host}: ${String(s.reason?.message ?? s.reason).slice(0, 40)}`);
      }
    });
    if (materials.length === 0) {
      return NextResponse.json(
        { ok: false, error: "모든 URL 본문 추출 실패", errors },
        { status: 502 }
      );
    }

    const material = await mergeSources({ materials, userPrompt: body.userPrompt });
    const project = await createProject({
      material,
      ownerEmail: (await getSessionEmail()) ?? undefined,
      styleProfileId,
      videoModelId,
      ttsEnabled: body.ttsEnabled ?? true,
      userPrompt: body.userPrompt,
    });
    return NextResponse.json({
      ok: true,
      projectId: project.id,
      merged: materials.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "fetch 실패" },
      { status: 502 }
    );
  }
}
