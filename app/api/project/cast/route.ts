import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";

export const runtime = "nodejs";

// [cliche] 등장 인물 이름(cast) 편집.
//   - { rename: { from, to } } : 인물 이름 변경 — cast·castVoices·씬 화자(speaker)를 한 번에 동기화.
//   - { cast: string[] }       : 인물 목록 통째 설정(추가/삭제).
export async function POST(req: NextRequest) {
  let body: { projectId?: string; rename?: { from?: string; to?: string }; cast?: unknown };
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

  const from = (body.rename?.from ?? "").trim();
  const to = (body.rename?.to ?? "").trim();
  if (from && to && from !== to) {
    // 이름 변경 — 인물명·화자별 목소리·씬 화자를 모두 새 이름으로.
    // cast 가 비어 있으면(옛 프로젝트) 씬 화자에서 파생해 시드한 뒤 변경.
    const base =
      project.cast?.length
        ? project.cast
        : [
            ...new Set(
              project.scenes.map((s) => s.speaker).filter((s) => !!s && s !== "내레이션") as string[]
            ),
          ];
    project.cast = [...new Set(base.map((c) => (c === from ? to : c)))];
    if (project.castVoices?.[from]) {
      const cv = { ...project.castVoices };
      cv[to] = cv[from];
      delete cv[from];
      project.castVoices = cv;
    }
    // 캐스팅 산출물(castMembers)의 이름도 함께 — cast/castVoices 와 항상 같은 키를 유지.
    if (project.castMembers?.length) {
      project.castMembers = project.castMembers.map((m) =>
        m.name === from ? { ...m, name: to } : m
      );
    }
    // 씬 화자 — 씬 단위(speaker)와 줄 단위(lines[].speaker) 모두 동기화.
    // (줄 화자를 빼먹으면 castVoices 조회가 옛 이름으로 실패해 그 줄만 기본 목소리로 떨어진다.)
    project.scenes = project.scenes.map((s) => {
      const lines = s.lines?.map((l) => (l.speaker === from ? { ...l, speaker: to } : l));
      const next = s.speaker === from ? { ...s, speaker: to } : s;
      return lines ? { ...next, lines } : next;
    });
  } else if (Array.isArray(body.cast)) {
    project.cast =
      body.cast.map((c) => (typeof c === "string" ? c.trim() : "")).filter(Boolean) || undefined;
    if (!project.cast?.length) project.cast = undefined;
  } else {
    return NextResponse.json({ ok: false, error: "rename 또는 cast 필요" }, { status: 400 });
  }

  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({
    ok: true,
    cast: project.cast ?? [],
    castVoices: project.castVoices ?? {},
  });
}
