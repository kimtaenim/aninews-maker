import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import { uploadVideoToDrive, isDriveConnected } from "@/lib/google";
import {
  pickCategory,
  nextDailySeq,
  buildUploadName,
  yymmdd,
} from "@/lib/uploadNaming";

export const runtime = "nodejs";
export const maxDuration = 120; // 영상 다운로드 + 드라이브 업로드

const VIDEO_FETCH_TIMEOUT = 90_000;

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

  // 분야: 스크립트로 Claude 자동 분류(첫 업로드 때 정해 저장, 이후 재사용).
  let category = project.category;
  if (!category) {
    category = await pickCategory(
      project.scenes.map((s) => s.narration).join(" "),
      projectId
    );
    project.category = category;
    project.updatedAt = Date.now();
    await saveProject(project);
  }
  // 파일명: 날짜-번호-분야-언어 (예: 260622-01-NEWS-KO.mp4)
  const seq = await nextDailySeq(yymmdd());
  const filename = buildUploadName({ seq, category, lang: project.lang });

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
