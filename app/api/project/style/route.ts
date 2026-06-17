import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { getStyleProfile } from "@/lib/styleProfiles";

export const runtime = "nodejs";

// 키프레임 단계 스타일 직접 조정.
// body: { projectId, styleProfileId?, styleBible? }
//  - styleProfileId 주면 모드 변경 + styleBible 을 그 프로필 기본값으로 리셋.
//  - styleBible 주면(모드 변경 없이) 프롬프트/팔레트 직접 편집 저장.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; styleProfileId?: string; styleBible?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (project.steps.keyframe.status === "approved") {
    return NextResponse.json(
      { ok: false, error: "키프레임이 이미 승인됐어요. 되돌리려면 다시 생성하세요." },
      { status: 409 }
    );
  }

  // 모드 변경
  if (typeof body.styleProfileId === "string" && body.styleProfileId) {
    let profile;
    try {
      profile = getStyleProfile(body.styleProfileId);
    } catch {
      return NextResponse.json(
        { ok: false, error: `스타일 프로필 없음: ${body.styleProfileId}` },
        { status: 400 }
      );
    }
    project.styleProfileId = profile.id;
    project.styleBible = profile.imageBible; // 모드 바뀌면 기본 bible 로 리셋
  } else if (typeof body.styleBible === "string") {
    const bible = body.styleBible.trim();
    if (!bible) {
      return NextResponse.json(
        { ok: false, error: "스타일 설명(프롬프트)은 비울 수 없어요" },
        { status: 422 }
      );
    }
    project.styleBible = bible;
  } else {
    return NextResponse.json(
      { ok: false, error: "styleProfileId 또는 styleBible 필요" },
      { status: 400 }
    );
  }

  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({
    ok: true,
    styleProfileId: project.styleProfileId,
    styleBible: project.styleBible,
  });
}
