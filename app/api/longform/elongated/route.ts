import { NextRequest, NextResponse } from "next/server";
import { getSessionEmail } from "@/lib/auth";
import { getProject, saveProject } from "@/lib/projectStore";
import { BLOCK_TYPE_IDS, buildElongated, validateTargetSec } from "@/lib/elongated";

export const runtime = "nodejs";
export const maxDuration = 60;

// 확장판 만들기 — 쇼츠 한 편(읽기 전용)을 원본으로 목표 길이만큼 늘릴 프로젝트를 만든다.
// 설계·본문·검수는 스튜디오에서 이어서. 원본은 절대 수정하지 않는다.
//   POST { sourceId, targetSec, presetName? }  → { ok, projectId }
export async function POST(req: NextRequest) {
  let body: { sourceId?: unknown; targetSec?: unknown; presetName?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const sourceId = typeof body.sourceId === "string" ? body.sourceId.trim() : "";
  if (!sourceId) {
    return NextResponse.json({ ok: false, error: "늘릴 원본을 골라주세요" }, { status: 400 });
  }

  try {
    const targetSec = validateTargetSec(body.targetSec);
    const source = await getProject(sourceId);
    if (!source) throw new Error("원본 숏폼을 찾을 수 없어요");
    if (!source.scenes?.length) throw new Error("대본이 없는 숏폼이에요");

    const ownerEmail = (await getSessionEmail()) ?? undefined;
    const project = buildElongated({
      source,
      targetSec,
      presetName: typeof body.presetName === "string" ? body.presetName : undefined,
      ownerEmail,
    });
    await saveProject(project);
    return NextResponse.json({ ok: true, projectId: project.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "확장판 만들기 실패" },
      { status: 400 }
    );
  }
}

// 확장판 설정 바꾸기 — 목표 길이 / 덧붙일 대목 유형.
// 저장은 항상 fresh 재읽기 후 해당 필드만 머지한다(통째 저장 금지 — 다른 필드가 날아간다).
//   PATCH { projectId, targetSec?, presetName?, blockTypes? }  → { ok, elongated }
export async function PATCH(req: NextRequest) {
  let body: {
    projectId?: unknown;
    targetSec?: unknown;
    presetName?: unknown;
    blockTypes?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }

  try {
    const project = await getProject(projectId);
    if (!project?.elongated) throw new Error("확장판이 아니에요");
    const track = { ...project.elongated };

    if (body.targetSec !== undefined) {
      track.targetSec = validateTargetSec(body.targetSec);
      track.presetName = typeof body.presetName === "string" ? body.presetName : undefined;
    }
    if (Array.isArray(body.blockTypes)) {
      const picked = body.blockTypes.filter(
        (x): x is string => typeof x === "string" && BLOCK_TYPE_IDS.includes(x)
      );
      track.blockTypes = [...new Set(picked)];
    }
    track.updatedAt = Date.now();

    await saveProject({ ...project, elongated: track, updatedAt: Date.now() });
    return NextResponse.json({ ok: true, elongated: track });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "설정 저장 실패" },
      { status: 400 }
    );
  }
}
