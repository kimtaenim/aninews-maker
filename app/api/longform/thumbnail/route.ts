import { NextRequest, NextResponse } from "next/server";
import { getProject, getProjectsBulk, saveProject } from "@/lib/projectStore";
import { buildThumbnails } from "@/lib/thumbnailGen";

export const runtime = "nodejs";
export const maxDuration = 300;

// [롱폼 모듈 5] 썸네일 — 구도 3종 프롬프트 → 이미지 생성 → 모듈 1의 문구 합성 → 168px 검증본.
// 제목 확정(finalTitle + finalThumbnailText)이 선행 조건. 대본 트랙과 병렬 실행 가능.
//   POST { projectId }             → 생성 → { ok, thumbnail }
//   POST { projectId, selected }   → 사용자 시안 확정 → { ok, thumbnail }
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    selected?: string;
    text?: string;
    styleExtra?: string;
    styleProfileId?: string;
    quality?: "low" | "medium" | "high";
    chipIds?: string[];
    referenceImageUrl?: string;
    // 생성 없이 설정만 저장(화면에서 고르는 즉시). 리로드해도 그대로 있어야 한다.
    settingsOnly?: boolean;
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

  // ── 설정만 저장 — 아직 생성 전이어도 고른 값이 남아야 한다(사용자 지적 2026-08-01).
  if (body.settingsOnly) {
    const fresh = (await getProject(projectId)) ?? longform;
    const cur = fresh.thumbnail;
    const settings = {
      styleProfileId: body.styleProfileId,
      quality: body.quality,
      chipIds: Array.isArray(body.chipIds) ? body.chipIds : undefined,
      extra: (body.styleExtra ?? "").trim() || undefined,
      referenceImageUrl: (body.referenceImageUrl ?? "").trim() || undefined,
    };
    fresh.thumbnail = cur
      ? { ...cur, settings, ...(body.text !== undefined ? { textUsed: body.text } : {}) }
      : {
          textUsed: body.text ?? "",
          variants: [],
          screening: {},
          generatedAt: 0, // 아직 안 만든 상태 — 설정만 담아 둔 껍데기
          settings,
        };
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, thumbnail: fresh.thumbnail });
  }

  // ── 시안 확정 모드
  if (body.selected) {
    const fresh = (await getProject(projectId)) ?? longform;
    if (!fresh.thumbnail) return NextResponse.json({ ok: false, error: "먼저 썸네일을 생성해주세요" }, { status: 422 });
    fresh.thumbnail = { ...fresh.thumbnail, selected: body.selected };
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, thumbnail: fresh.thumbnail });
  }

  const titlePkg = longform.longformTitle;
  const finalTitle = titlePkg?.finalTitle?.trim();
  const thumbnailText = (body.text ?? "").trim() || titlePkg?.finalThumbnailText?.trim() || "";
  if (!finalTitle || !thumbnailText) {
    return NextResponse.json(
      { ok: false, error: "모듈 1에서 제목을 먼저 확정해주세요(썸네일 문구가 거기서 나와요)" },
      { status: 422 }
    );
  }

  // 첫 세그먼트 소재 — 대본이 정한 순서가 있으면 그 첫 편, 없으면 현재 첫 세그먼트.
  const orderedFirstId =
    longform.longformScript?.segmentOrder?.[0]?.segmentId ?? (longform.sourceProjectIds ?? [])[0];
  let firstSegmentTopic = longform.longformScript?.opening.blockAHook ?? "";
  if (orderedFirstId) {
    const [seg] = await getProjectsBulk([orderedFirstId]);
    if (seg) {
      firstSegmentTopic =
        `${seg.title} — ` +
        (seg.scenes ?? []).map((s) => s.narration).filter(Boolean).join(" ").slice(0, 300);
    }
  }

  try {
    const pkg = await buildThumbnails({
      projectId,
      title: finalTitle,
      titlePromise: titlePkg?.titlePromise ?? "",
      firstSegmentTopic,
      thumbnailText,
      // 화면에서 켠 스타일 칩·직접 쓴 지시(그림에만 붙는다).
      styleExtra: (body.styleExtra ?? "").trim() || undefined,
      styleProfileId: body.styleProfileId,
      quality: body.quality,
      referenceImageUrl: (body.referenceImageUrl ?? "").trim() || undefined,
    });
    const fresh = (await getProject(projectId)) ?? longform;
    // 쓴 설정을 같이 저장 — 다시 만들 때 화면이 그대로 복원된다.
    pkg.settings = {
      styleProfileId: body.styleProfileId,
      quality: body.quality,
      chipIds: Array.isArray(body.chipIds) ? body.chipIds : undefined,
      extra: (body.styleExtra ?? "").trim() || undefined,
      referenceImageUrl: (body.referenceImageUrl ?? "").trim() || undefined,
    };
    fresh.thumbnail = pkg;
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, thumbnail: pkg });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "썸네일 생성 실패" },
      { status: 500 }
    );
  }
}
