import { NextRequest, NextResponse } from "next/server";
import { generatePortrait } from "@/lib/image";
import { getStyleProfile } from "@/lib/styleProfiles";
import { formatKrw } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 120; // 이미지 생성은 수십 초

// [cliche] 캐스팅 포트레이트 생성 — 새 프로젝트 위저드(프로젝트 생성 전)용이라 무상태:
// 생성/변환 → Blob 업로드 → URL 반환만 하고, 저장은 호출자(위저드 → /api/cliche/new)가 한다.
// body: { draftId?, projectId?, styleProfileId?, name?, archetype?, description?, uploadUrl? }
//   - uploadUrl 있으면: 업로드 사진 → 항상 스타일화(웹툰) 변환(딥페이크 방지 — 실사 복제 금지)
//   - 없으면: 그림체 바이블 + 이름/성격/설명으로 가상 인물 생성
export async function POST(req: NextRequest) {
  let body: {
    draftId?: string;
    projectId?: string;
    styleProfileId?: string;
    name?: string;
    archetype?: string;
    description?: string;
    uploadUrl?: string;
    quality?: string; // "low" | "medium"(기본) | "high"
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  const draftId = (body.draftId ?? "").trim().replace(/[^\w-]/g, "").slice(0, 64);
  if (!projectId && !draftId) {
    return NextResponse.json({ ok: false, error: "draftId 또는 projectId 필요" }, { status: 400 });
  }
  const uploadUrl = (body.uploadUrl ?? "").trim();
  const name = (body.name ?? "").trim();
  const archetype = (body.archetype ?? "").trim();
  const description = (body.description ?? "").trim();
  if (!uploadUrl && !name && !archetype && !description) {
    return NextResponse.json(
      { ok: false, error: "사진을 올리거나 이름·성격·외모 설명 중 하나는 입력해주세요" },
      { status: 400 }
    );
  }

  // 그림체 바이블(설명 생성 모드용). 업로드 변환은 함수 안에서 웹툰 바이블로 고정된다.
  let styleBible: string;
  try {
    styleBible = getStyleProfile(
      body.styleProfileId === "realistic" ? "realistic" : "webtoon-romance"
    ).imageBible;
  } catch {
    return NextResponse.json({ ok: false, error: "style profile not found" }, { status: 400 });
  }

  try {
    const quality =
      body.quality === "low" || body.quality === "high" ? body.quality : undefined;
    const { url, costUsd } = await generatePortrait({
      blobPrefix: projectId ? `project/${projectId}` : `casting/${draftId}`,
      projectId: projectId || undefined,
      styleBible,
      name: name || undefined,
      archetype: archetype || undefined,
      description: description || undefined,
      faceImageUrl: uploadUrl || undefined,
      ...(quality ? { quality } : {}),
    });
    return NextResponse.json({ ok: true, url, cost: formatKrw(costUsd) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "포트레이트 생성 실패";
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
