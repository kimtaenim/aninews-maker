import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { getRedis } from "@/lib/redis";
import { reviewLongform, type LongformReviewInput } from "@/lib/longformReview";
import type { LongformOpening } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ApplyPayload {
  opening?: string[];
  connectors?: { after: number; revised: string }[];
  closing?: string[];
  order?: number[];
}

// 롱폼 전체 구조 검수 + 채택.
//   POST { projectId }          → 검수 → { ok, review }
//   POST { projectId, apply }   → 채택 반영(오프닝·세그먼트순서·연결·마무리) → { ok }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; apply?: ApplyPayload };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const longform = await getProject(projectId);
  if (!longform) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // ── 채택 반영 모드 ──
  if (body.apply) {
    const a = body.apply;
    const now = Date.now();
    // 1) 세그먼트 순서(0-based 인덱스 재배열).
    if (Array.isArray(a.order) && a.order.length) {
      const cur = longform.sourceProjectIds ?? [];
      if (a.order.length === cur.length && [...a.order].sort((x, y) => x - y).join(",") === cur.map((_, i) => i).join(",")) {
        const fresh = (await getProject(projectId)) ?? longform;
        fresh.sourceProjectIds = a.order.map((i) => cur[i]);
        fresh.updatedAt = now;
        await saveProject(fresh);
      }
    }
    // 2) 오프닝 스크립트.
    if (Array.isArray(a.opening) && a.opening.length) {
      const fresh = (await getProject(projectId)) ?? longform;
      const prev = fresh.opening;
      const opening: LongformOpening = prev
        ? { ...prev, script: a.opening, generatedAt: now }
        : {
            script: a.opening,
            openLoop: { question: "", closesAt: "마지막 챕터", closingLineHint: "" },
            chapterBridges: [],
            selfCheck: {},
            generatedAt: now,
          };
      fresh.opening = opening;
      fresh.updatedAt = now;
      await saveProject(fresh);
    }
    // 3) 연결·마무리 → 진행자 프로젝트 씬(hostSlot) 나레이션.
    if ((a.connectors?.length || a.closing?.length) && longform.hostProjectId) {
      const host = await getProject(longform.hostProjectId);
      if (host) {
        const scenes = [...(host.scenes ?? [])];
        if (a.connectors?.length) {
          for (const c of a.connectors) {
            const idx = scenes.findIndex((s) => s.hostSlot === "connector" && (s.connectorAfter ?? 0) === c.after);
            if (idx >= 0) scenes[idx] = { ...scenes[idx], narration: c.revised };
          }
        }
        if (a.closing?.length) {
          const closingIdxs = scenes.map((s, i) => (s.hostSlot === "closing" ? i : -1)).filter((i) => i >= 0);
          a.closing.forEach((line, k) => {
            const target = closingIdxs[Math.min(k, closingIdxs.length - 1)];
            if (target >= 0) scenes[target] = { ...scenes[target], narration: line };
          });
        }
        host.scenes = scenes;
        host.updatedAt = now;
        await saveProject(host);
      }
    }
    try {
      const cur = (await getRedis().get<Record<string, unknown>>(`longformreview:${projectId}`)) ?? {};
      cur.apply = { ...a, at: now };
      await getRedis().set(`longformreview:${projectId}`, cur);
    } catch {
      /* 로깅 무시 */
    }
    return NextResponse.json({ ok: true });
  }

  // ── 검수 모드 ──
  const segIds = longform.sourceProjectIds ?? [];
  if (segIds.length < 2) {
    return NextResponse.json({ ok: false, error: "세그먼트가 2개 이상이어야 해요" }, { status: 422 });
  }
  const segProjects = await getProjectsBulk(segIds);
  const byId = new Map(segProjects.map((s) => [s.id, s]));
  const segments = segIds.map((id, i) => {
    const s = byId.get(id);
    return {
      title: s?.title ?? `세그먼트 ${i + 1}`,
      summary: (s?.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ").slice(0, 250),
    };
  });
  const openingLines = longform.opening?.script ?? [];
  const connectors: { after: number; text: string }[] = [];
  const closingLines: string[] = [];
  if (longform.hostProjectId) {
    const host = await getProject(longform.hostProjectId);
    for (const sc of host?.scenes ?? []) {
      if (sc.hostSlot === "connector") connectors.push({ after: sc.connectorAfter ?? 0, text: sc.narration ?? "" });
      if (sc.hostSlot === "closing") closingLines.push(sc.narration ?? "");
    }
    connectors.sort((x, y) => x.after - y.after);
  }
  const input: LongformReviewInput = {
    topic: longform.title,
    openingLines,
    segments,
    connectors,
    closingLines,
    declaredLoop: longform.opening?.openLoop ?? null,
    chapterBridges: longform.opening?.chapterBridges ?? [],
  };

  try {
    const review = await reviewLongform({ projectId, input });
    try {
      await getRedis().set(`longformreview:${projectId}`, { projectId, review, reviewedAt: Date.now() });
      await getRedis().sadd("longformreview:ids", projectId);
    } catch {
      /* 로깅 무시 */
    }
    return NextResponse.json({ ok: true, review });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "롱폼 구조 검수 실패" },
      { status: 500 }
    );
  }
}
