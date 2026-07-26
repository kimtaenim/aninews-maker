import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import {
  generateLongformTitles,
  reviewLongformTitle,
  type LongformConstituent,
  type LongformTitleInput,
} from "@/lib/longformTitleGen";
import type { LongformTitlePackage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 90;

// [롱폼 모듈 1] 제목 생성기 — 검색 5원칙으로 검색어 → 후보 5개 → 추천 + title_promise.
// title_promise 가 모듈 2~5 전부의 기준점이라, 여기서 멈추고 사용자 확정을 받는다.
//   POST { projectId, constituents?, coreTopic?, viewerPayoff?, targetKeywords? }
//        → 생성 → { ok, title: LongformTitlePackage }
//   POST { projectId, review: "직접 쓴 제목" }
//        → 그 제목을 원칙으로 진단 → { ok, review } (원문은 안 바꾼다. 확정은 별도)
//   POST { projectId, confirm: { title, thumbnailText?, titlePromise? } }
//        → 사용자 확정(프로젝트 제목도 갱신) → { ok, title }
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    review?: string;
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

  // ── 검증 모드 — 직접 쓴 제목을 원칙으로 진단만 한다(원문·확정 상태는 안 건드림).
  if (typeof body.review === "string") {
    const title = body.review.trim();
    if (!title) return NextResponse.json({ ok: false, error: "검증할 제목을 입력해주세요" }, { status: 400 });
    try {
      // 본편 구성 요약 — "본편이 약속을 주는가" 판정 근거.
      const segIds = longform.sourceProjectIds ?? [];
      let context = "";
      if (segIds.length) {
        const segs = await getProjectsBulk(segIds);
        const byId = new Map(segs.map((s) => [s.id, s]));
        context = segIds
          .map((id, i) => {
            const s = byId.get(id);
            if (!s) return "";
            const summ = (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ").slice(0, 200);
            return `${i + 1}. ${s.title} — ${summ}`;
          })
          .filter(Boolean)
          .join("\n");
      }
      const review = await reviewLongformTitle({ projectId, title, context: context || undefined });
      // 검증 결과는 패키지에 남긴다(리로드해도 보이게). 확정은 사용자가 따로 누른다.
      const fresh = (await getProject(projectId)) ?? longform;
      const pkg = fresh.longformTitle;
      fresh.longformTitle = pkg
        ? { ...pkg, review }
        : {
            keywordCandidates: [],
            primaryKeyword: review.primaryKeyword,
            secondaryKeyword: "",
            keywordRationale: review.keywordRationale,
            candidates: [],
            rejected: [],
            recommendation: "",
            recommendedIndex: 0,
            titlePromise: "",
            review,
            generatedAt: Date.now(),
          };
      fresh.updatedAt = Date.now();
      await saveProject(fresh);
      return NextResponse.json({ ok: true, review, title: fresh.longformTitle });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "제목 검증 실패" },
        { status: 500 }
      );
    }
  }

  // ── 확정 모드 — 고른(또는 직접 쓴) 제목을 패키지에 박고 프로젝트 제목도 바꾼다.
  if (body.confirm) {
    const title = (body.confirm.title ?? "").trim();
    if (!title) return NextResponse.json({ ok: false, error: "확정할 제목이 필요해요" }, { status: 400 });
    const fresh = (await getProject(projectId)) ?? longform;
    const pkg = fresh.longformTitle;
    const picked = pkg?.candidates.find((c) => c.title === title);
    // title_promise 는 이후 전 모듈의 기준점 — 후보/검증 결과/기존 값 순으로 찾는다.
    const promise =
      (body.confirm.titlePromise ?? "").trim() ||
      (pkg?.review?.title === title ? pkg.review.titlePromise : "") ||
      (picked ? pkg?.titlePromise ?? "" : "") ||
      pkg?.titlePromise ||
      "";
    const thumbText =
      (body.confirm.thumbnailText ?? "").trim() ||
      picked?.thumbnailText ||
      (pkg?.review?.title === title ? pkg.review.thumbnailText : "") ||
      pkg?.finalThumbnailText ||
      "";
    if (!promise) {
      return NextResponse.json(
        { ok: false, error: "title_promise 가 없어요 — 제목을 검증하거나 생성해서 약속한 괴리를 먼저 뽑아주세요" },
        { status: 422 }
      );
    }
    // 생성 없이 직접 쓴 제목만으로 확정하는 경우 — 빈 패키지를 만들어 준다.
    const base: LongformTitlePackage = pkg ?? {
      keywordCandidates: [],
      primaryKeyword: "",
      secondaryKeyword: "",
      keywordRationale: "",
      candidates: [],
      rejected: [],
      recommendation: "",
      recommendedIndex: 0,
      titlePromise: "",
      generatedAt: Date.now(),
    };
    fresh.longformTitle = {
      ...base,
      finalTitle: title,
      finalThumbnailText: thumbText,
      titlePromise: promise,
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
    // title_promise 가 이후 전 모듈의 기준점이라 세그먼트 내용을 넉넉히 봐야 한다.
    // 10분+ 롱폼(20~30편)까지 감안해 총량을 편수로 나눈다(편당 최대 2000자).
    const perSeg = Math.min(2000, Math.max(600, Math.floor(40_000 / Math.max(1, segIds.length))));
    constituents = segIds
      .map((id) => byId.get(id))
      .filter((s): s is NonNullable<typeof s> => !!s)
      .map((s) => {
        const full = (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" ");
        return {
          title: s.title,
          topic: full.length > perSeg ? `${full.slice(0, perSeg)}…(이하 생략)` : full,
          segmentId: s.id,
        };
      });
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
