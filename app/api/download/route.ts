import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// 완성 영상 다운로드 프록시 — Blob(다른 도메인) URL을 같은 도메인에서 받아 다시 내려주되
// Content-Disposition: attachment 를 붙여 폰/데스크탑에서 "열기"가 아니라 "다운로드"되게.
//   GET ?projectId&kind=clean?  → mp4 (attachment). kind=clean 이면 "영상만" 합성본.
export async function GET(req: NextRequest) {
  const projectId = (req.nextUrl.searchParams.get("projectId") ?? "").trim();
  const clean = req.nextUrl.searchParams.get("kind") === "clean";
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const project = await getProject(projectId);
  const url = clean ? project?.cleanVideoUrl : project?.finalVideoUrl;
  if (!url) {
    return NextResponse.json(
      { ok: false, error: clean ? "영상만(클린) 합성본이 없어요" : "완성 영상이 없어요" },
      { status: 404 }
    );
  }
  const r = await fetch(url);
  if (!r.ok || !r.body) {
    return NextResponse.json({ ok: false, error: "영상을 불러오지 못했어요" }, { status: 502 });
  }
  const filename = `aninews-${projectId.slice(0, 8)}${clean ? "-clean" : ""}.mp4`;
  return new Response(r.body, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
