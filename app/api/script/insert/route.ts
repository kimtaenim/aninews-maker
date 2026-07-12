import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import type { Scene } from "@/lib/types";

export const runtime = "nodejs";

// 빈 씬을 특정 위치 뒤에 삽입한다. body: { projectId, insertAfterIndex, mood? }
// mood=true 면 [cliche] 분위기 씬(대사·더빙·자막 없음, 영상+효과음만)으로 삽입.
// 서버의 project.scenes 를 직접 splice 하므로 뒤 씬들의 산출물(imageUrl/videoUrl/
// audioUrl 등)이 배열 원소와 함께 그대로 따라가고, index 만 재부여된다(클라이언트
// 자동저장의 index 기반 carry 가 중간 삽입에서 어긋나는 문제를 피한다).
// insertAfterIndex 는 0..len-1 로 클램프 — 씬0(키프레임) 앞에는 넣지 않는다.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; insertAfterIndex?: number; mood?: boolean };
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
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "씬이 아직 없어요" }, { status: 409 });
  }

  const last = project.scenes.length - 1;
  const after = Math.max(0, Math.min(Math.floor(Number(body.insertAfterIndex ?? last)), last));

  const mood = body.mood === true;
  const fresh: Scene = {
    index: 0, // 아래에서 재부여
    // 분위기 씬은 narration 이 "분위기 묘사"(이미지 생성 컨텍스트) — 자막·더빙엔 안 쓴다.
    narration: mood ? "감성 인서트 — 분위기 묘사를 적어주세요 (예: 노을 지는 옥상, 흔들리는 커튼)" : "",
    ...(mood ? { mood: true } : {}),
    imagePrompt: "",
    motion: "",
    durationSec: mood ? 4 : 5,
    status: "generated",
  };

  project.scenes.splice(after + 1, 0, fresh);
  project.scenes = project.scenes.map((s, i) => ({ ...s, index: i }));
  project.steps.script.updatedAt = Date.now();
  project.updatedAt = Date.now();
  await saveProject(project);

  return NextResponse.json({ ok: true, scenes: project.scenes, insertedAt: after + 1 });
}
