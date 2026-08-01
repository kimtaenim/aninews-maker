import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { generateLongformScript } from "@/lib/longformScript";
import { screenScript } from "@/lib/longformScreening";
import { buildSections } from "@/lib/longform";
import { syncHostScenes } from "@/lib/longformHost";
import type { LongformConstituent } from "@/lib/longformTitleGen";
import type { LongformOpening, LongformScriptPackage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 180;

// 모듈 2~4의 결과를 기존 구조 검수(longformReview)가 읽는 LongformOpening 으로 미러링.
function mirrorOpening(pkg: LongformScriptPackage): LongformOpening {
  return {
    script: [pkg.opening.blockAHook, pkg.opening.blockBRoadmapLanding],
    openLoop: {
      question: pkg.titlePromise,
      closesAt: "엔딩 파트 A",
      closingLineHint: pkg.ending.partAClose,
    },
    chapterBridges: pkg.bridges.map((b) => ({
      chapter: b.afterSegment + 1,
      role: b.isMidpointReopen ? "중간점 환기" : "고리 유지",
      bridgeHint: `${b.emphasis} / ${b.elevation} / ${b.opening}`,
    })),
    selfCheck: { roadmapLeak: false, midpointExitCost: pkg.screening["20초검수"] },
    generatedAt: pkg.generatedAt,
  };
}

// [롱폼 모듈 2~4] 오프닝(2블록) · 세그먼트 순서 + 브리지 · 엔딩(3파트)을 일괄 생성.
// 모듈 1의 제목 확정(longformTitle.finalTitle)이 선행 조건 — title_promise 가 기준점이라서.
//   POST { projectId, fixedOrder?, constituents?, viewerPayoff? } → { ok, script, violations, orderApplied }
//   POST { projectId, edit: {...} }                              → 사용자 수정 저장(재생성 없음)
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    fixedOrder?: boolean;
    viewerPayoff?: string;
    constituents?: Array<{ segmentId?: string; performance?: string; topic?: string }>;
    edit?: {
      blockAHook?: string;
      blockBRoadmapLanding?: string;
      bridges?: Array<{ afterSegment?: number; emphasis?: string; elevation?: string; opening?: string; isMidpointReopen?: boolean }>;
      partAClose?: string;
      partBLanding?: string;
      partCStandard?: string;
      endscreenVideo?: string;
    };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const longform = await getProject(projectId);
  if (!longform) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  const segIds = longform.sourceProjectIds ?? [];

  // ── 수정 저장 모드 — 지적된 블록만 잘게 고친다(되뒤집기 금지).
  if (body.edit) {
    const fresh = (await getProject(projectId)) ?? longform;
    const cur = fresh.longformScript;
    if (!cur) return NextResponse.json({ ok: false, error: "먼저 대본을 생성해주세요" }, { status: 422 });
    const e = body.edit;
    const next: LongformScriptPackage = {
      ...cur,
      opening: {
        ...cur.opening,
        blockAHook: (e.blockAHook ?? cur.opening.blockAHook).trim(),
        blockBRoadmapLanding: (e.blockBRoadmapLanding ?? cur.opening.blockBRoadmapLanding).trim(),
      },
      bridges: e.bridges
        ? cur.bridges.map((b, i) => {
            const patch = e.bridges!.find((x) => x.afterSegment === b.afterSegment) ?? e.bridges![i];
            return patch
              ? {
                  ...b,
                  emphasis: (patch.emphasis ?? b.emphasis).trim(),
                  elevation: (patch.elevation ?? b.elevation).trim(),
                  opening: (patch.opening ?? b.opening).trim(),
                  isMidpointReopen: patch.isMidpointReopen ?? b.isMidpointReopen,
                }
              : b;
          })
        : cur.bridges,
      ending: {
        ...cur.ending,
        partAClose: (e.partAClose ?? cur.ending.partAClose).trim(),
        partBLanding: (e.partBLanding ?? cur.ending.partBLanding).trim(),
        partCStandard: (e.partCStandard ?? cur.ending.partCStandard).trim(),
        endscreenVideo: (e.endscreenVideo ?? cur.ending.endscreenVideo).trim(),
      },
    };
    const screen = screenScript(next, segIds.length || next.bridges.length + 1);
    next.opening.estSeconds = screen.openingSeconds;
    next.ending.estSeconds = screen.endingSeconds;
    next.screening = { ...next.screening, ...screen.computed };
    fresh.longformScript = next;
    fresh.opening = mirrorOpening(next);
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    // ★ 씬은 대본을 따라온다 — 사용자가 따로 "펼치기"를 누르지 않는다(숏폼과 같게).
    await syncHostScenes(projectId).catch(() => null);
    return NextResponse.json({ ok: true, script: next, violations: screen.violations, orderApplied: false });
  }

  // ── 생성 모드
  const finalTitle = longform.longformTitle?.finalTitle?.trim();
  const titlePromise = longform.longformTitle?.titlePromise?.trim();
  if (!finalTitle || !titlePromise) {
    return NextResponse.json(
      { ok: false, error: "모듈 1에서 제목을 먼저 확정해주세요(title_promise 가 기준점이에요)" },
      { status: 422 }
    );
  }
  if (segIds.length < 2) {
    return NextResponse.json({ ok: false, error: "세그먼트가 2개 이상이어야 해요" }, { status: 422 });
  }

  const segProjects = await getProjectsBulk(segIds);
  const byId = new Map(segProjects.map((s) => [s.id, s]));
  const overrides = new Map((body.constituents ?? []).map((c) => [(c.segmentId ?? "").trim(), c]));
  // 연결 멘트는 앞뒤 세그먼트 내용을 알아야 쓸 수 있다. 400자로 자르니 부실했다.
  // 10분+ 롱폼(세그먼트 20~30편)까지 감안해 총량 예산을 편수로 나눠 배분한다(편당 최대 3000자).
  const SEG_TOTAL_BUDGET = 60_000;
  const perSeg = Math.min(3000, Math.max(900, Math.floor(SEG_TOTAL_BUDGET / Math.max(1, segIds.length))));
  const constituents: LongformConstituent[] = segIds
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => {
      const ov = overrides.get(s.id);
      const full = (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ");
      return {
        title: s.title,
        topic:
          (ov?.topic ?? "").trim() ||
          (full.length > perSeg ? `${full.slice(0, perSeg)}…(이하 생략)` : full),
        performance: (ov?.performance ?? "").trim() || undefined,
        segmentId: s.id,
      };
    });
  if (constituents.length < 2) {
    return NextResponse.json({ ok: false, error: "세그먼트 대본이 비어 있어요" }, { status: 422 });
  }

  try {
    const { pkg, violations } = await generateLongformScript({
      projectId,
      input: {
        title: finalTitle,
        titlePromise,
        viewerPayoff: (body.viewerPayoff ?? "").trim() || "구성 편들의 핵심을 한 번에 이해하고 내 계좌 관점을 얻는다",
        constituents,
        fixedOrder: body.fixedOrder === true,
      },
    });

    const fresh = (await getProject(projectId)) ?? longform;
    // 제안 순서가 현재와 다르면 반영한다 — 브리지가 제안 순서 기준으로 쓰였기 때문.
    const proposed = pkg.segmentOrder.map((s) => s.segmentId).filter((x): x is string => !!x);
    const same = proposed.length === segIds.length && proposed.join("|") === segIds.join("|");
    let orderApplied = false;
    if (!same && proposed.length === segIds.length) {
      fresh.sourceProjectIds = proposed;
      if (Array.isArray(fresh.sections) && fresh.sections.length > 0) fresh.sections = buildSections(proposed);
      orderApplied = true;
    }
    fresh.longformScript = pkg;
    fresh.opening = mirrorOpening(pkg);
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    // ★ 대본이 새로 나왔으면 씬도 그 자리에서 갱신한다(따로 누르는 단계를 만들지 않는다).
    await syncHostScenes(projectId).catch(() => null);

    return NextResponse.json({ ok: true, script: pkg, violations, orderApplied });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "대본 생성 실패" },
      { status: 500 }
    );
  }
}
