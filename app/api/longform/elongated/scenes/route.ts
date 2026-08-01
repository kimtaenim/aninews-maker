import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { buildScenesFromPlan } from "@/lib/elongatedScenes";
import { expiringCards } from "@/lib/elongated";
import type { Project, StepKind } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// [확장판 ⑥] 렌더로 보내기 — 챕터 본문을 씬으로 펼쳐 기존 파이프라인에 태운다.
// 확장판 전용 렌더 경로를 만들지 않는다(지시서). 씬이 생기면 그 뒤는 기존 스튜디오가 처리.
//   POST { projectId, confirmedExpiring?: true }  → { ok, sceneCount }
//   재확인이 필요한 카드(expires)가 있는데 confirmedExpiring 이 없으면 409 + 목록을 돌려준다.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; confirmedExpiring?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const project = await getProject(projectId);
  const track = project?.elongated;
  const plan = track?.plan;
  if (!project || !track || !plan) {
    return NextResponse.json({ ok: false, error: "설계가 아직 없어요" }, { status: 404 });
  }
  if (!plan.approvedAt) {
    return NextResponse.json({ ok: false, error: "설계를 먼저 승인해 주세요" }, { status: 409 });
  }
  const unwritten = plan.chapters.filter((c) => !(c.body ?? "").trim());
  if (unwritten.length > 0) {
    return NextResponse.json(
      { ok: false, error: `본문이 안 된 챕터가 있어요 (${unwritten.map((c) => c.index).join(", ")}번)` },
      { status: 422 }
    );
  }

  // 게시 전 재확인 목록 — 가격·시세류 카드는 시간이 지나면 틀려진다.
  const expiring = expiringCards(track.facts);
  if (expiring.length > 0 && body.confirmedExpiring !== true) {
    return NextResponse.json(
      {
        ok: false,
        needsConfirm: true,
        error: "게시 전 재확인이 필요한 사실이 있어요",
        expiring: expiring.map((f) => ({
          id: f.id,
          fact: f.fact,
          sourceName: f.sourceName,
          sourceUrl: f.sourceUrl,
          sourceDate: f.sourceDate,
          fetchedAt: f.fetchedAt,
        })),
      },
      { status: 409 }
    );
  }

  const scenes = buildScenesFromPlan(plan);
  if (scenes.length === 0) {
    return NextResponse.json({ ok: false, error: "펼칠 본문이 없어요" }, { status: 422 });
  }

  // 저장 직전 fresh 재읽기 — 씬과 단계 상태만 갈아끼운다.
  const fresh = (await getProject(projectId)) ?? project;
  const now = Date.now();
  const steps = { ...fresh.steps };
  const set = (k: StepKind, status: "approved" | "pending") => {
    steps[k] = { ...steps[k], kind: k, status, updatedAt: now };
  };
  set("source", "approved");
  set("script", "approved"); // 대본은 확장판 화면에서 확정됐다
  for (const k of ["keyframe", "images", "videos", "voiceover", "compose"] as StepKind[]) {
    set(k, "pending");
  }

  const next: Project = {
    ...fresh,
    scenes,
    steps,
    elongated: { ...(fresh.elongated ?? track), updatedAt: now },
    updatedAt: now,
  };
  await saveProject(next);

  return NextResponse.json({ ok: true, sceneCount: scenes.length });
}
