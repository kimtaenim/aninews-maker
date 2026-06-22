import { NextRequest, NextResponse } from "next/server";
import { getProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { uploadVideoToDrive, isDriveConnected } from "@/lib/google";
import { getLang } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 120; // 영상 다운로드 + 드라이브 업로드

const VIDEO_FETCH_TIMEOUT = 90_000;

function safeName(s: string): string {
  return (
    (s || "video")
      .replace(/[\\/:*?"<>|\n\r]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "video"
  );
}
function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// 완성 영상을 사용자 드라이브(ANINEWS 폴더)에 업로드. 파일명 자동(제목_언어_날짜).
// body: { projectId }
export async function POST(req: NextRequest) {
  const email = await getSessionEmail();
  if (!email) return NextResponse.json({ ok: false, error: "로그인이 필요해요" }, { status: 401 });

  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  if (!(await isDriveConnected(email))) {
    return NextResponse.json(
      { ok: false, error: "Google 드라이브를 먼저 연결해주세요", needConnect: true },
      { status: 409 }
    );
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (!project.finalVideoUrl) {
    return NextResponse.json({ ok: false, error: "완성된 영상이 없어요 (먼저 합성)" }, { status: 409 });
  }

  const langLabel = project.lang ? getLang(project.lang)?.label ?? project.lang : "한국어";
  const filename = `${safeName(project.title)}_${langLabel}_${dateStamp()}.mp4`;

  try {
    const r = await fetch(project.finalVideoUrl, {
      signal: AbortSignal.timeout(VIDEO_FETCH_TIMEOUT),
    });
    if (!r.ok) throw new Error(`영상 다운로드 실패 (HTTP ${r.status})`);
    const bytes = Buffer.from(await r.arrayBuffer());
    const { link } = await uploadVideoToDrive({ email, filename, bytes });
    return NextResponse.json({ ok: true, link, filename });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "업로드 실패" },
      { status: 500 }
    );
  }
}
