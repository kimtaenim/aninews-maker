import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { getRedis } from "@/lib/redis";
import { reviewLongform, type LongformReviewInput } from "@/lib/longformReview";
import { screenScript } from "@/lib/longformScreening";
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
    // 2) 오프닝·연결·엔딩 → ★ 진행자 대본(longformScript)에 반영. 이게 원천이라 여기 안 쓰면
    //    화면(대본 패널·재생 순서)엔 옛 문장이 그대로 남는다(2026-07-25 수정).
    if (a.opening?.length || a.connectors?.length || a.closing?.length) {
      const fresh = (await getProject(projectId)) ?? longform;
      const cur = fresh.longformScript;
      if (cur) {
        const next = { ...cur };
        if (a.opening?.length) {
          next.opening = {
            ...cur.opening,
            blockAHook: a.opening[0] ?? cur.opening.blockAHook,
            blockBRoadmapLanding: a.opening[1] ?? cur.opening.blockBRoadmapLanding,
          };
        }
        if (a.connectors?.length) {
          // 검수기는 연결을 한 덩어리 문장으로 돌려준다 → 방점에 넣고 나머지 역할은 비운다
          // (역할 구분보다 "말이 되는 문장"이 우선이라 쪼개지 않는다).
          next.bridges = cur.bridges.map((b) => {
            const hit = a.connectors!.find((c) => c.after === b.afterSegment);
            return hit ? { ...b, emphasis: hit.revised, elevation: "", opening: "" } : b;
          });
        }
        if (a.closing?.length) {
          next.ending = {
            ...cur.ending,
            partAClose: a.closing[0] ?? cur.ending.partAClose,
            partBLanding: a.closing[1] ?? cur.ending.partBLanding,
            // 파트 C(구독 표준 문구)는 고정 — 검수 결과로 덮지 않는다.
          };
        }
        const screen = screenScript(next, (fresh.sourceProjectIds ?? []).length || next.bridges.length + 1);
        next.opening.estSeconds = screen.openingSeconds;
        next.ending.estSeconds = screen.endingSeconds;
        next.screening = { ...next.screening, ...screen.computed };
        fresh.longformScript = next;
      }
      // 구조 검수기(열린 고리)가 읽는 미러도 같이 갱신.
      if (a.opening?.length) {
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
      }
      fresh.updatedAt = now;
      await saveProject(fresh);
    }
    // 3) 오프닝·연결·마무리 → 진행자 프로젝트 씬(hostSlot) 나레이션. (오프닝도 진행자가 하므로 여기 반영)
    if ((a.opening?.length || a.connectors?.length || a.closing?.length) && longform.hostProjectId) {
      const host = await getProject(longform.hostProjectId);
      if (host) {
        const scenes = [...(host.scenes ?? [])];
        const applyBySlot = (lines: string[], slot: "opening" | "closing") => {
          const idxs = scenes.map((s, i) => (s.hostSlot === slot ? i : -1)).filter((i) => i >= 0);
          lines.forEach((line, k) => {
            const target = idxs[Math.min(k, idxs.length - 1)];
            if (target >= 0) scenes[target] = { ...scenes[target], narration: line };
          });
        };
        if (a.opening?.length) applyBySlot(a.opening, "opening");
        if (a.connectors?.length) {
          for (const c of a.connectors) {
            const idx = scenes.findIndex((s) => s.hostSlot === "connector" && (s.connectorAfter ?? 0) === c.after);
            if (idx >= 0) scenes[idx] = { ...scenes[idx], narration: c.revised };
          }
        }
        if (a.closing?.length) applyBySlot(a.closing, "closing");
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
  // 전체 흐름을 보려면 세그먼트 내용이 충분히 보여야 한다(250자로는 훅 구조 판정이 안 됐다).
  const segments = segIds.map((id, i) => {
    const s = byId.get(id);
    return {
      title: s?.title ?? `세그먼트 ${i + 1}`,
      summary: (s?.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ").slice(0, 900),
    };
  });
  // ★ 진행자 대본(longformScript)이 원천이다. 예전엔 진행자 "씬"에서만 읽어서, 씬을 아직
  // 안 펼친 상태(대본만 생성)에서는 연결·엔딩이 빈 채로 검수됐다(2026-07-25 수정).
  // 대본이 없으면 씬에서 읽고, 그것도 없으면 옛 opening 미러를 쓴다.
  const pkg = longform.longformScript;
  let connectors: { after: number; text: string }[] = [];
  let closingLines: string[] = [];
  let openingLines: string[] = [];

  if (pkg) {
    openingLines = [pkg.opening.blockAHook, pkg.opening.blockBRoadmapLanding].filter(Boolean);
    connectors = pkg.bridges.map((b) => ({
      after: b.afterSegment,
      text: [b.emphasis, b.elevation, b.opening].filter(Boolean).join(" "),
    }));
    closingLines = [pkg.ending.partAClose, pkg.ending.partBLanding, pkg.ending.partCStandard].filter(Boolean);
  } else if (longform.hostProjectId) {
    const host = await getProject(longform.hostProjectId);
    for (const sc of host?.scenes ?? []) {
      if (sc.hostSlot === "opening") openingLines.push(sc.narration ?? "");
      if (sc.hostSlot === "connector") connectors.push({ after: sc.connectorAfter ?? 0, text: sc.narration ?? "" });
      if (sc.hostSlot === "closing") closingLines.push(sc.narration ?? "");
    }
    connectors.sort((x, y) => x.after - y.after);
  } else {
    openingLines = longform.opening?.script ?? [];
  }
  const input: LongformReviewInput = {
    topic: longform.title,
    openingLines,
    segments,
    connectors,
    closingLines,
    // 기준 고리 = 확정 제목이 약속한 괴리(title_promise). 대본·검수가 같은 고리를 본다.
    declaredLoop: pkg
      ? {
          question: pkg.titlePromise,
          closesAt: "엔딩 파트 A",
          closingLineHint: pkg.ending.partAClose,
        }
      : longform.opening?.openLoop ?? null,
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
