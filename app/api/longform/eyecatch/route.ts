import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateEyecatch } from "@/lib/image";

export const runtime = "nodejs";
export const maxDuration = 120;

// 롱폼 아이캐치 생성 — config/eyecatch.json 의 마스코트(송곳니 안경 미소녀 + 구독 버튼)를
// 16:9로 1장 생성해 project.eyecatchUrl 에 저장. 세그먼트 사이마다 재사용된다.
//   POST { projectId }  → { ok, url }
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
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

  try {
    const { url } = await generateEyecatch({ projectId });
    // 생성(수십 초) 동안 다른 저장이 있었을 수 있으니 최신 재읽기 후 eyecatchUrl 만 머지.
    const fresh = (await getProject(projectId)) ?? project;
    fresh.eyecatchUrl = url;
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "아이캐치 생성 실패" },
      { status: 500 }
    );
  }
}
