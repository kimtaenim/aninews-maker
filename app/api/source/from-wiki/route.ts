import { NextRequest, NextResponse } from "next/server";
import { extractFromWikipedia } from "@/lib/wikipedia";
import { mergeSources } from "@/lib/mergeSources";
import { createProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { getStyleProfile, DEFAULT_STYLE_PROFILE_ID } from "@/lib/styleProfiles";
import type { SourceMaterial } from "@/lib/source";
import videoModels from "@/config/video-models.json";

export const runtime = "nodejs";
export const maxDuration = 60;

// 1. source (위키백과) — 표제어/주소 1개 또는 여러 개 → 공식 API 로 본문 추출, 여러 개면
// 1개 주제로 종합 → 프로젝트 생성.
// body: { input? | inputs?[], userPrompt?, styleProfileId?, videoModelId?, ttsEnabled? }
export async function POST(req: NextRequest) {
  let body: {
    input?: string;
    inputs?: string[];
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

  const rawIn = Array.isArray(body.inputs) ? body.inputs : body.input ? [body.input] : [];
  const inputs = Array.from(
    new Set(rawIn.map((s) => (s ?? "").trim()).filter(Boolean))
  ).slice(0, 20);
  if (inputs.length === 0) {
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
    const settled = await Promise.allSettled(inputs.map((x) => extractFromWikipedia(x)));
    const materials: SourceMaterial[] = [];
    const errors: string[] = [];
    settled.forEach((s, i) => {
      if (s.status === "fulfilled") materials.push(s.value);
      else errors.push(`${inputs[i].slice(0, 30)}: ${String(s.reason?.message ?? s.reason).slice(0, 40)}`);
    });
    if (materials.length === 0) {
      return NextResponse.json(
        { ok: false, error: "위키백과 추출 실패", errors },
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
      { ok: false, error: e instanceof Error ? e.message : "위키백과 추출 실패" },
      { status: 502 }
    );
  }
}
