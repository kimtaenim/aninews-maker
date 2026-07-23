import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { generateLongformTitles, type LongformConstituent, type LongformTitleInput } from "@/lib/longformTitleGen";
import type { LongformTitlePackage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

// [롱폼 모듈 1] 제목 생성기 — 검색 5원칙으로 검색어 → 후보 5개 → 추천 + title_promise.
// title_promise 가 모듈 2~5 전부의 기준점이라, 여기서 멈추고 사용자 확정을 받는다.
//   POST { projectId, constituents?, coreTopic?, viewerPayoff?, targetKeywords? }
//        → 생성 → { ok, title: LongformTitlePackage }
//   POST { projectId, confirm: { title, thumbnailText?, titlePromise? } }
//        → 사용자 확정(프로젝트 제목도 갱신) → { ok, title }
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    confirm?: { title?: string; thumbnailText?: string; titlePromise?: string };
    constituents?: Array<{ title?: string; topic?: string; performance?: string; segmentId?: string }>;
    coreTopic?: string;
    viewerPayoff?: string;
    targetKeywords?: string[];
    type?: "compilation" | "original";
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

  // ── 확정 모드 — 사용자가 고른 제목을 패키지에 박고 프로젝트 제목도 바꾼다.
  if (body.confirm) {
    const title = (body.confirm.title ?? "").trim();
    if (!title) return NextResponse.json({ ok: false, error: "확정할 제목이 필요해요" }, { status: 400 });
    const fresh = (await getProject(projectId)) ?? longform;
    const pkg = fresh.longformTitle;
    if (!pkg) return NextResponse.json({ ok: false, error: "먼저 제목을 생성해주세요" }, { status: 422 });
    const picked = pkg.candidates.find((c) => c.title === title);
    fresh.longformTitle = {
      ...pkg,
      finalTitle: title,
      finalThumbnailText: (body.confirm.thumbnailText ?? picked?.thumbnailText ?? pkg.finalThumbnailText ?? "").trim(),
      titlePromise: (body.confirm.titlePromise ?? pkg.titlePromise ?? "").trim(),
      confirmedAt: Date.now(),
    };
    fresh.title = title;
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, title: fresh.longformTitle });
  }

  // ── 생성 모드 — 구성(constituents)은 body 우선, 없으면 세그먼트에서 도출.
  const segIds = longform.sourceProjectIds ?? [];
  let constituents: LongformConstituent[] = (body.constituents ?? [])
    .map((c) => ({
      title: (c.title ?? "").trim(),
      topic: (c.topic ?? "").trim(),
      performance: (c.performance ?? "").trim() || undefined,
      segmentId: (c.segmentId ?? "").trim() || undefined,
    }))
    .filter((c) => c.title.length > 0);

  if (constituents.length === 0) {
    if (segIds.length < 1) return NextResponse.json({ ok: false, error: "세그먼트가 없어요" }, { status: 422 });
    const segProjects = await getProjectsBulk(segIds);
    const byId = new Map(segProjects.map((s) => [s.id, s]));
    constituents = segIds
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => ({
        title: s.title,
        topic: (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ").slice(0, 300),
        segmentId: s.id,
      }));
  }
  if (constituents.length === 0) {
    return NextResponse.json({ ok: false, error: "구성(세그먼트) 대본이 비어 있어요" }, { status: 422 });
  }

  const input: LongformTitleInput = {
    type: body.type ?? "compilation",
    constituents,
    coreTopic: (body.coreTopic ?? "").trim() || longform.title,
    viewerPayoff:
      (body.viewerPayoff ?? "").trim() ||
      "구성 편들의 핵심을 한 번에 이해하고 내 계좌 관점의 판단 근거를 얻는다",
    targetKeywords: (body.targetKeywords ?? []).map((k) => k.trim()).filter(Boolean),
  };

  try {
    const pkg = await generateLongformTitles({ projectId, input });
    const fresh = (await getProject(projectId)) ?? longform;
    // 이전 확정값은 유지(재생성해도 사용자가 다시 확정할 때까지 기존 확정 제목을 안 지운다).
    const prev: Partial<LongformTitlePackage> = fresh.longformTitle
      ? {
          finalTitle: fresh.longformTitle.finalTitle,
          finalThumbnailText: fresh.longformTitle.finalThumbnailText,
          confirmedAt: fresh.longformTitle.confirmedAt,
        }
      : {};
    fresh.longformTitle = { ...pkg, ...prev };
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, title: fresh.longformTitle });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "제목 생성 실패" },
      { status: 500 }
    );
  }
}
