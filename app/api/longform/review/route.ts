import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { getRedis } from "@/lib/redis";
import { reviewLongform, type LongformReviewInput } from "@/lib/longformReview";
import { screenScript } from "@/lib/longformScreening";
import { buildSections } from "@/lib/longform";
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
    // ★ 마무리 줄 짝 맞추기 — 검수기가 돌려주는 줄 수는 보낸 줄 수와 다를 수 있다.
    // 여운이 위반으로 잡히면 그 줄을 빼고 [답, 구독] 2줄만 돌려준다 — 순서대로 밀어 넣으면
    // 구독 문구가 여운 칸에 들어가 구독을 두 번 읽는다(실측 확인).
    // 구독 문구는 고정이라 검수 대상이 아니므로 걸러내고, 남은 [답, 여운]만 반영한다.
    const closingBody = (a.closing ?? [])
      .filter((l): l is string => typeof l === "string" && l.trim().length > 0)
      .map((l) => l.trim())
      .filter((l) => !l.includes("구독"));
    // 1) 세그먼트 순서(0-based 인덱스 재배열).
    if (Array.isArray(a.order) && a.order.length) {
      const cur = longform.sourceProjectIds ?? [];
      if (a.order.length === cur.length && [...a.order].sort((x, y) => x - y).join(",") === cur.map((_, i) => i).join(",")) {
        const fresh = (await getProject(projectId)) ?? longform;
        const order = a.order.map((i) => cur[i]);
        fresh.sourceProjectIds = order;
        // ★ 섹션도 같이 다시 묶는다 — 합성은 sections 단위로 돌기 때문에 여기서 빼먹으면
        // 화면에 보이는 재생 순서와 실제로 구워지는 순서가 달라진다(reorder·script 경로와 동일).
        if (Array.isArray(fresh.sections) && fresh.sections.length > 0) fresh.sections = buildSections(order);
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
        if (closingBody.length) {
          next.ending = {
            ...cur.ending,
            partAClose: closingBody[0] || cur.ending.partAClose,
            // 검수기가 답만 돌려줬으면 여운은 뺀 것으로 본다(빈칸이 기본이라 그래도 된다).
            partBLanding: closingBody[1] ?? "",
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
        let scenes = [...(host.scenes ?? [])];
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
        if (closingBody.length) {
          // 마무리 씬 = [답, (여운), 구독]. 마지막(구독)은 고정이라 덮지 않는다.
          const idxs = scenes.map((s, i) => (s.hostSlot === "closing" ? i : -1)).filter((i) => i >= 0);
          const editable = idxs.slice(0, Math.max(0, idxs.length - 1));
          closingBody.forEach((line, k) => {
            const target = editable[k];
            if (target !== undefined) scenes[target] = { ...scenes[target], narration: line };
          });
          // 검수기가 여운을 뺐으면 그 씬도 지워야 한다 — 남기면 대사 없는 정지 화면이 된다.
          const stale = new Set(editable.slice(closingBody.length));
          if (stale.size) scenes = scenes.filter((_, i) => !stale.has(i)).map((s, i) => ({ ...s, index: i }));
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
  // 전체 흐름을 보려면 세그먼트 내용이 충분히 보여야 한다(250자로는 훅 구조 판정이 안 됐다).
  // 10분+ 롱폼(세그먼트 20~30편)까지 감안해 총량 예산을 세그먼트 수로 나눠 배분한다.
  // Sonnet 1M 컨텍스트라 총 6만자(≈4만 토큰)는 넉넉하다. 편당 상한은 3000자.
  const SEG_TOTAL_BUDGET = 60_000;
  const perSeg = Math.min(3000, Math.max(900, Math.floor(SEG_TOTAL_BUDGET / Math.max(1, segIds.length))));
  const segments = segIds.map((id, i) => {
    const s = byId.get(id);
    const full = (s?.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ");
    return {
      title: s?.title ?? `세그먼트 ${i + 1}`,
      // 잘릴 때만 말줄임 — 잘렸는지 모델이 알아야 "끝이 이상하다"는 오판을 안 한다.
      summary: full.length > perSeg ? `${full.slice(0, perSeg)}…(이하 생략)` : full,
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
