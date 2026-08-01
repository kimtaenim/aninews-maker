import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { bodyChars, generateChapterBody } from "@/lib/elongatedBody";
import { elongatedSourceScenes } from "@/lib/elongated";
import type { ElongatedPlan, Project } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// 챕터는 앞 챕터 끝을 이어받아야 하므로 순서대로 쓴다(동시 실행 불가).
// 한 요청 안에서 마감까지만 쓰고, 남은 챕터는 화면이 이어서 부른다.
const START_DEADLINE_MS = 210_000;
const TAIL_CHARS = 300; // 앞 챕터 끝에서 이어붙일 참고 분량

// [확장판 ④] 본문 생성 — 설계 승인 뒤에만 돈다(동의 게이트).
//   POST { projectId, all: true }   → 아직 안 쓴 챕터를 순서대로(마감까지)
//   POST { projectId, chapter }     → 그 챕터만 다시 쓰기
//   → { ok, written, pending, plan }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; chapter?: unknown; all?: unknown };
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
  // ★ 동의 게이트 — 승인 없이는 본문을 쓰지 않는다.
  if (!plan.approvedAt) {
    return NextResponse.json(
      { ok: false, error: "설계를 먼저 승인해 주세요" },
      { status: 409 }
    );
  }

  const source = await getProject(track.sourceProjectId);
  if (!source?.scenes?.length) {
    return NextResponse.json(
      { ok: false, error: "원본 숏폼을 찾을 수 없어요 — 삭제된 것 같아요" },
      { status: 422 }
    );
  }
  const sourceScenes = elongatedSourceScenes(source.scenes).map((s) => s.narration ?? "");

  const targets =
    body.all === true
      ? plan.chapters.filter((c) => !(c.body ?? "").trim()).map((c) => c.index)
      : [Math.trunc(Number(body.chapter))].filter((n) => Number.isInteger(n));
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, written: 0, pending: [], plan });
  }

  const deadline = Date.now() + START_DEADLINE_MS;
  const written = new Map<number, string>();
  // 앞 챕터 꼬리 — 이미 쓴 본문에서 가져오고, 이번에 쓴 것으로 갱신한다.
  const bodyOf = (idx: number): string =>
    written.get(idx) ?? plan.chapters.find((c) => c.index === idx)?.body ?? "";

  try {
    for (const idx of targets) {
      if (Date.now() >= deadline) break;
      const chapter = plan.chapters.find((c) => c.index === idx);
      if (!chapter) continue;
      const prev = bodyOf(idx - 1);
      const { body: text } = await generateChapterBody({
        projectId,
        chapter,
        plan,
        sourceScenes,
        facts: track.facts,
        targetSec: track.targetSec,
        previousTail: prev ? prev.slice(-TAIL_CHARS) : undefined,
      });
      written.set(idx, text);
    }
  } catch (e) {
    // 여기까지 쓴 것은 살려서 저장한다 — 다시 부르면 남은 챕터만 쓴다.
    if (written.size === 0) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "본문 생성 실패" },
        { status: 500 }
      );
    }
  }

  // 저장 직전 fresh 재읽기 후 이 챕터들만 머지(통째 저장 금지).
  const fresh = (await getProject(projectId)) ?? project;
  const freshTrack = fresh.elongated;
  const freshPlan = freshTrack?.plan;
  if (!freshTrack || !freshPlan) {
    return NextResponse.json({ ok: false, error: "설계가 사라졌어요" }, { status: 409 });
  }
  const now = Date.now();
  const chapters = freshPlan.chapters.map((c) => {
    const text = written.get(c.index);
    return text ? { ...c, body: text, bodyGeneratedAt: now } : c;
  });
  const nextPlan: ElongatedPlan = { ...freshPlan, chapters };
  const next: Project = {
    ...fresh,
    elongated: {
      ...freshTrack,
      plan: nextPlan,
      // 본문이 바뀌면 이전 본문 기준의 검수 결과는 의미가 없다.
      factCheck: undefined,
      score: undefined,
      updatedAt: now,
    },
    updatedAt: now,
  };
  await saveProject(next);

  return NextResponse.json({
    ok: true,
    written: written.size,
    chars: Object.fromEntries([...written].map(([i, t]) => [i, bodyChars(t)])),
    pending: nextPlan.chapters.filter((c) => !(c.body ?? "").trim()).map((c) => c.index),
    plan: nextPlan,
  });
}
