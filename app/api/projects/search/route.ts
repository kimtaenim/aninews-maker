import { NextRequest, NextResponse } from "next/server";
import { listAllProjectIds, listProjectIds, getProjectsBulk } from "@/lib/projectStore";
import { searchTerms, matchesQuery, isBundleCandidate } from "@/lib/projectSearch";
import { sourceSeconds } from "@/lib/elongated";

export const runtime = "nodejs";
export const maxDuration = 60;

// 프로젝트 검색 — 롱폼 묶기처럼 "선택 상태를 유지한 채" 목록만 갈아끼워야 하는 화면용.
// (라이브러리는 서버 렌더 ?q= 를 그대로 쓴다. 규칙은 lib/projectSearch.ts 로 공유.)
//   GET /api/projects/search?q=환율&kind=bundle&limit=120
//     · q 있으면 전체 대상(옛날 것 포함), 없으면 최근 순으로 limit 개.
//     · kind=bundle → 롱폼 묶기 후보(완성된 세로 숏폼)만.
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") ?? "").trim();
  const kind = sp.get("kind") ?? "bundle";
  const limit = Math.min(300, Math.max(20, parseInt(sp.get("limit") ?? "120", 10) || 120));

  try {
    const terms = searchTerms(q);
    // 검색이면 옛날 것까지 전부 대상(라이브러리와 동일), 아니면 최근 순 일부.
    const ids = q ? await listAllProjectIds() : await listProjectIds(0, limit);
    const projects = await getProjectsBulk(ids);
    const filtered = projects
      .filter((p) => (kind === "bundle" ? isBundleCandidate(p) : true))
      .filter((p) => matchesQuery(p, terms));
    return NextResponse.json({
      ok: true,
      total: filtered.length,
      scanned: ids.length,
      items: filtered.slice(0, limit).map((p) => ({
        id: p.id,
        title: p.title,
        keyframeUrl: p.keyframeUrl,
        // 확장판 원본 고르기 화면이 쓰는 값(묶기 화면은 안 읽는다).
        sceneCount: (p.scenes ?? []).filter((s) => !s.skipped).length,
        speakSec: sourceSeconds(p.scenes ?? []),
        createdAt: p.createdAt,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "검색 실패" },
      { status: 500 }
    );
  }
}
