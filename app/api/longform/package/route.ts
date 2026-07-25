import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { screenScript } from "@/lib/longformScreening";

export const runtime = "nodejs";

// [롱폼] 최종 조립 출력 — 모듈 1~5의 산출물을 지시서 6번 형태의 단일 JSON 으로 묶는다.
// 대본 패키지(모듈 2~4)에 없는 검수 항목은 여기서 계산·합산한다.
//   GET /api/longform/package?projectId=…  → 조립 JSON
export async function GET(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const p = await getProject(projectId);
  if (!p) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });

  const t = p.longformTitle;
  const s = p.longformScript;
  const th = p.thumbnail;
  const segCount = (p.sourceProjectIds ?? []).length;
  const screen = s ? screenScript(s, segCount || s.bridges.length + 1) : null;

  const screening: Record<string, string> = {
    제목호응: s?.screening["제목호응"] ?? "미생성",
    고리일치: s?.screening["고리일치"] ?? "미생성",
    조기폐쇄: s?.screening["조기폐쇄"] ?? "미생성",
    진행자길이: screen?.computed["진행자길이"] ?? "미생성",
    척추검수: s?.screening["척추검수"] ?? "미생성",
    "20초검수": s?.screening["20초검수"] ?? "미생성",
    썸네일검수: th
      ? Object.entries(th.screening)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" / ")
      : "미생성",
  };
  if (screen?.violations.length) screening["코드검수_위반"] = screen.violations.join("; ");

  return NextResponse.json({
    ok: true,
    package: {
      title: {
        final: t?.finalTitle ?? "",
        thumbnail_text: t?.finalThumbnailText ?? "",
        primary_keyword: t?.primaryKeyword ?? "",
        title_promise: t?.titlePromise ?? "",
      },
      segment_order: (s?.segmentOrder ?? []).map((o) => ({
        order: o.order,
        title: o.title,
        rationale: o.rationale,
      })),
      script: s
        ? {
            opening: {
              block_a_hook: s.opening.blockAHook,
              block_b_roadmap_landing: s.opening.blockBRoadmapLanding,
              est_seconds: s.opening.estSeconds,
            },
            bridges: s.bridges.map((b) => ({
              after_segment: b.afterSegment,
              방점: b.emphasis,
              승격: b.elevation,
              개방: b.opening,
              is_midpoint_reopen: b.isMidpointReopen,
            })),
            ending: {
              part_a_close: s.ending.partAClose,
              part_b_landing: s.ending.partBLanding,
              part_c_standard: s.ending.partCStandard,
              endscreen_video: s.ending.endscreenVideo,
              est_seconds: s.ending.estSeconds,
            },
          }
        : null,
      thumbnail: th
        ? {
            image_prompts: th.variants.map((v) => v.prompt),
            files: th.variants.map((v) => v.fileUrl).filter(Boolean),
            preview_168px: th.variants.map((v) => v.previewUrl).filter(Boolean),
            text_used: th.textUsed,
            selected: th.selected ?? "",
            ab_test_note: "유튜브 스튜디오 '테스트 및 비교'에 시안 3종을 걸어 시청 데이터로 승자를 고를 것",
          }
        : null,
      screening,
    },
  });
}
