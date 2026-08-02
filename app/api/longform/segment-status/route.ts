import { NextRequest, NextResponse } from "next/server";
import { getProject, getComposeProgressLine } from "@/lib/projectStore";

export const runtime = "nodejs";

// [롱폼] 세그먼트 한 편의 제작 상태 — 롱폼 화면이 세그먼트에 안 들어가고도
// 가로판(키프레임→그림→영상→합성)을 일괄 진행할 수 있게 필요한 것만 돌려준다.
//   GET ?projectId → { ok, ... }
export async function GET(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  const p = await getProject(projectId);
  if (!p) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });

  const scenes = p.scenes ?? [];
  const imagesMissing = scenes
    .map((s, i) => (i > 0 && !s.imageUrl && !s.skipped ? i : -1))
    .filter((i) => i >= 0);
  const audioMissing = scenes
    .map((s, i) => (!s.audioUrl && !s.skipped && (s.narration ?? "").trim() ? i : -1))
    .filter((i) => i >= 0);
  const videosMissing = scenes
    .map((s, i) => (s.imageUrl && !s.videoUrl && !s.skipped && s.videoSource !== "upload" ? i : -1))
    .filter((i) => i >= 0);

  return NextResponse.json({
    ok: true,
    sceneCount: scenes.length,
    keyframeReady: !!p.keyframeUrl,
    keyframeApproved: p.steps.keyframe.status === "approved",
    imagesMissing,
    audioMissing,
    imagesApproved: p.steps.images.status === "approved",
    videosMissing,
    videosApproved: p.steps.videos.status === "approved",
    composeStatus: p.steps.compose.status,
    composeProgress: await getComposeProgressLine(projectId),
    finalVideoUrl: p.finalVideoUrl ?? null,
  });
}
