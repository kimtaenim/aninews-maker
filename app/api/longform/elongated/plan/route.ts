import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateElongatedPlan, missingBlocks, pendingBlocks } from "@/lib/elongatedPlan";
import { elongatedSourceScenes } from "@/lib/elongated";

export const runtime = "nodejs";
export const maxDuration = 120; // 검색 없는 설계 — 길지 않다

// [확장판 ③-1] 확장 설계 — 챕터 배치 + 덧붙일 대목 + 무엇을 찾을지(검색어).
// 사실 확인은 여기서 하지 않는다(대목 하나씩 /plan/facts 가 맡는다 — 300초 상한 대응).
// 본문도 쓰지 않는다. 설계서를 저장하고 화면에서 멈춘다(승인 전엔 본문 생성 잠김).
//   POST { projectId }  → { ok, plan, pending }
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const project = await getProject(projectId);
  if (!project?.elongated) {
    return NextResponse.json({ ok: false, error: "확장판이 아니에요" }, { status: 404 });
  }
  const track = project.elongated;

  const source = await getProject(track.sourceProjectId);
  if (!source?.scenes?.length) {
    return NextResponse.json(
      { ok: false, error: "원본 숏폼을 찾을 수 없어요 — 삭제된 것 같아요" },
      { status: 422 }
    );
  }

  try {
    const { plan, violations } = await generateElongatedPlan({
      projectId,
      input: {
        sourceTitle: source.title,
        sourceScenes: elongatedSourceScenes(source.scenes).map((s) => s.narration ?? ""),
        sourceSeconds: track.sourceSeconds,
        targetSec: track.targetSec,
        blockTypes: track.blockTypes,
      },
    });

    // 저장 직전 fresh 재읽기 후 해당 필드만 머지(통째 저장 금지 — 다른 편집이 날아간다).
    const fresh = (await getProject(projectId)) ?? project;
    const now = Date.now();
    fresh.elongated = {
      ...(fresh.elongated ?? track),
      plan, // 새 설계 — 승인(approvedAt)은 비어 있다
      facts: [], // 설계가 바뀌면 이전 사실 카드는 붙을 자리가 없다
      factCheck: undefined,
      score: undefined,
      updatedAt: now,
    };
    fresh.updatedAt = now;
    await saveProject(fresh);

    return NextResponse.json({
      ok: true,
      plan,
      violations,
      pending: pendingBlocks(plan),
      missing: missingBlocks(plan),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "확장 설계 실패" },
      { status: 500 }
    );
  }
}

// 설계 승인 / 대목 켜고 끄기.
//   PATCH { projectId, approve?: true, toggle?: { chapter, block, enabled } }
export async function PATCH(req: NextRequest) {
  let body: {
    projectId?: string;
    approve?: unknown;
    toggle?: { chapter?: unknown; block?: unknown; enabled?: unknown };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const project = await getProject(projectId);
  const plan = project?.elongated?.plan;
  if (!project?.elongated || !plan) {
    return NextResponse.json({ ok: false, error: "설계가 아직 없어요" }, { status: 404 });
  }

  const next = { ...plan, chapters: plan.chapters.map((c) => ({ ...c, blocks: [...c.blocks] })) };

  if (body.toggle) {
    const ci = Math.trunc(Number(body.toggle.chapter));
    const bi = Math.trunc(Number(body.toggle.block));
    const ch = next.chapters.find((c) => c.index === ci);
    if (ch && ch.blocks[bi]) {
      ch.blocks[bi] = { ...ch.blocks[bi], enabled: body.toggle.enabled !== false };
    }
  }
  if (body.approve === true) next.approvedAt = Date.now();

  const now = Date.now();
  await saveProject({
    ...project,
    elongated: { ...project.elongated, plan: next, updatedAt: now },
    updatedAt: now,
  });
  return NextResponse.json({ ok: true, plan: next });
}
