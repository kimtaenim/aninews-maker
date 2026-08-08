import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import type { Watermark } from "@/lib/types";

export const runtime = "nodejs";

const POS = ["tl", "tr", "bl", "br"];

// 워터마크 저장. body: { projectId, watermark: { text, position } }
// text 가 비면 워터마크 제거.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; watermark?: Partial<Watermark>; credit?: string };
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

  const text = (body.watermark?.text ?? "").trim().slice(0, 60);
  const posIn = body.watermark?.position;
  // 그림 워터마크 — 넘어온 값이 있으면 갱신, 빈 문자열이면 제거, 아예 없으면 기존 유지.
  const imgIn = body.watermark?.imageUrl;
  const imageUrl =
    imgIn === undefined ? project.watermark?.imageUrl : imgIn.trim() || undefined;
  const scaleIn = body.watermark?.imageScale;
  const imageScale =
    typeof scaleIn === "number" && Number.isFinite(scaleIn)
      ? Math.min(0.4, Math.max(0.04, scaleIn))
      : project.watermark?.imageScale;
  const opIn = body.watermark?.imageOpacity;
  const imageOpacity =
    typeof opIn === "number" && Number.isFinite(opIn)
      ? Math.min(1, Math.max(0.1, opIn))
      : project.watermark?.imageOpacity;

  // 글자와 그림 중 하나라도 있으면 워터마크는 남는다(그림만 쓰는 경우가 있다).
  if (!text && !imageUrl) {
    project.watermark = undefined;
  } else {
    project.watermark = {
      text,
      position: POS.includes(posIn as string)
        ? (posIn as Watermark["position"])
        : project.watermark?.position ?? "br",
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageUrl && imageScale ? { imageScale } : {}),
      ...(imageUrl && imageOpacity !== undefined ? { imageOpacity } : {}),
    };
  }
  // 제작 크레딧 이름(마지막 2씬). body 에 credit 이 있으면 갱신(빈 문자열=제거).
  if (body.credit !== undefined) {
    const credit = body.credit.trim().slice(0, 60);
    project.credit = credit || undefined;
  }
  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({
    ok: true,
    watermark: project.watermark ?? null,
    credit: project.credit ?? null,
  });
}
