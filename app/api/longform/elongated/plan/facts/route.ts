import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import {
  findChapterFacts,
  missingBlocks,
  pendingBlocks,
  pendingChapters,
} from "@/lib/elongatedPlan";
import { nextCardId } from "@/lib/elongated";
import type { ElongatedPlan, FactCard, Project } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

// 실측(2026-07-26): 대목 하나씩 부르면 한 건에 ₩551·89초 — 15대목이면 ₩8,265·22분이라 못 쓴다.
// 같은 챕터의 대목들은 소재가 겹쳐 검색 결과를 나눠 쓸 수 있으므로 챕터 단위로 한 번에 부르고,
// 챕터들을 동시에 돌린 뒤 저장은 마지막에 한 번만 한다(중간 저장을 여러 번 하면 서로 덮어쓴다).
const CONCURRENCY = 6;
// 새 챕터를 시작하는 마감 — 여기서 시작한 것이 끝날 때까지가 300초 안에 들어와야 한다.
const START_DEADLINE_MS = 150_000;

// [확장판 ③-2] 사실 찾기 — 덧붙일 대목의 근거를 web_search 로 확인해 카드로 만든다.
//   POST { projectId, all: true }   → 아직 안 찾은 챕터 전부(마감까지)
//   POST { projectId, chapter }     → 그 챕터만 다시 찾기
//   → { ok, added, pending, pendingChapters, plan, facts, remainingMissing }
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
  const plan = project?.elongated?.plan;
  if (!project?.elongated || !plan) {
    return NextResponse.json({ ok: false, error: "설계가 아직 없어요" }, { status: 404 });
  }

  const targets: number[] =
    body.all === true
      ? pendingChapters(plan)
      : [Math.trunc(Number(body.chapter))].filter((n) => Number.isInteger(n));
  if (targets.length === 0) {
    return NextResponse.json({
      ok: true,
      added: 0,
      pending: pendingBlocks(plan),
      pendingChapters: [],
      plan,
      facts: project.elongated.facts,
    });
  }

  const source = await getProject(project.elongated.sourceProjectId);
  const sourceTitle = source?.title ?? project.title;
  const deadline = Date.now() + START_DEADLINE_MS;

  // ── 챕터들을 동시에(원본 스냅샷으로 읽기만 한다 — 저장은 전부 끝난 뒤 한 번) ──
  // 대목 인덱스는 "켜 둔 대목만" 추린 뒤의 순번이 아니라 원래 인덱스를 유지해야 한다.
  type Done = {
    chapter: number;
    facts: Map<number, Omit<FactCard, "id">[]>; // 원래 대목 인덱스 → 사실
    missing: Map<number, string>;
    // 호출 자체가 실패했는가. 실패는 "찾아봤는데 없음"과 다르다 — 찾은 것으로 표시하면
    // 다시 찾기 대상에서 빠져 영영 빈 채로 남는다(실제로 그렇게 됐다).
    failed: boolean;
  };
  const done: Done[] = [];
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      if (Date.now() >= deadline) continue; // 마감 넘김 — 남은 건 화면이 다시 부른다
      const ci = targets[i];
      const chapter = plan!.chapters.find((c) => c.index === ci);
      if (!chapter) continue;
      // 켜져 있고 아직 안 찾은 대목만 보낸다(다시 찾기면 켜진 것 전부).
      const picked = chapter.blocks
        .map((b, bi) => ({ b, bi }))
        .filter((x) => x.b.enabled && (body.all !== true || !x.b.searchedAt));
      if (picked.length === 0) continue;
      try {
        const found = await findChapterFacts({
          projectId,
          context: { sourceTitle, chapterTitle: chapter.title, role: chapter.role },
          blocks: picked.map((x) => ({ type: x.b.type, need: x.b.need, query: x.b.query })),
        });
        // 보낸 순번(0..picked-1) → 원래 대목 인덱스로 되돌린다.
        const facts = new Map<number, Omit<FactCard, "id">[]>();
        const missing = new Map<number, string>();
        picked.forEach((x, k) => {
          facts.set(x.bi, found.byBlock.get(k) ?? []);
          const m = found.missing.get(k);
          if (m) missing.set(x.bi, m);
        });
        done.push({ chapter: ci, facts, missing, failed: !found.searched });
      } catch (e) {
        // 호출 자체가 실패한 것은 "근거를 못 찾음"과 다르다 — 원문은 로그로, 화면엔 짧게.
        const raw = e instanceof Error ? e.message : String(e);
        console.error(`[elongated-facts] chapter ${ci} 실패:`, raw);
        const short = `찾기 실패 — ${raw.slice(0, 120)}`;
        const missing = new Map<number, string>();
        picked.forEach((x) => missing.set(x.bi, short));
        done.push({ chapter: ci, facts: new Map(), missing, failed: true });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  // ── 저장(fresh 재읽기 후 이 대목들만 머지) ──
  const fresh = (await getProject(projectId)) ?? project;
  const track = fresh.elongated;
  const freshPlan = track?.plan;
  if (!track || !freshPlan) {
    return NextResponse.json({ ok: false, error: "설계가 사라졌어요" }, { status: 409 });
  }

  const cards = [...track.facts];
  const now = Date.now();
  const idsByBlock = new Map<string, string[]>(); // "chapter:block" → 카드 id들
  for (const d of done) {
    for (const [bi, list] of d.facts) {
      const ids: string[] = [];
      for (const f of list) {
        const card: FactCard = { ...f, id: nextCardId(cards) };
        cards.push(card);
        ids.push(card.id);
      }
      idsByBlock.set(`${d.chapter}:${bi}`, ids);
    }
  }

  const chapters = freshPlan.chapters.map((c) => {
    const d = done.find((x) => x.chapter === c.index);
    if (!d) return c;
    const blocks = c.blocks.map((b, bi) => {
      const touched = d.facts.has(bi) || d.missing.has(bi);
      if (!touched) return b;
      return {
        ...b,
        factIds: idsByBlock.get(`${c.index}:${bi}`) ?? [],
        missing: d.missing.get(bi) || undefined,
        // 실패는 미검색으로 남긴다 — 다시 찾기 대상에서 빠지면 안 된다.
        ...(d.failed ? {} : { searchedAt: now }),
      };
    });
    return { ...c, blocks };
  });

  const nextPlan: ElongatedPlan = { ...freshPlan, chapters };
  const next: Project = {
    ...fresh,
    elongated: { ...track, plan: nextPlan, facts: cards, updatedAt: now },
    updatedAt: now,
  };
  await saveProject(next);

  return NextResponse.json({
    ok: true,
    added: cards.length - track.facts.length,
    searchedChapters: done.length,
    pending: pendingBlocks(nextPlan),
    pendingChapters: pendingChapters(nextPlan), // 마감에 걸려 남은 것 — 화면이 이어서 부른다
    plan: nextPlan,
    facts: cards,
    remainingMissing: missingBlocks(nextPlan),
  });
}
