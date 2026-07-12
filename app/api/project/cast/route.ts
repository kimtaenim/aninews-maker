import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import type { CastMember } from "@/lib/types";

export const runtime = "nodejs";

// [cliche] 등장 인물 이름(cast) 편집.
//   - { rename: { from, to } } : 인물 이름 변경 — cast·castVoices·씬 화자(speaker)를 한 번에 동기화.
//   - { cast: string[] }       : 인물 목록 통째 설정(추가/삭제).
//   - { member: { name, ...패치 } } : 캐스팅 산출물(castMembers) 한 명 패치 — 포트레이트
//     재편집(Studio)용. 없던 인물이면 추가, castMembers 가 없으면 cast 에서 시드.
export async function POST(req: NextRequest) {
  let body: {
    projectId?: string;
    rename?: { from?: string; to?: string };
    cast?: unknown;
    member?: {
      name?: string;
      archetype?: string;
      faceSource?: string;
      faceUploadUrl?: string;
      faceDesc?: string;
      portraitUrl?: string;
      voiceId?: string;
    };
  };
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
  } else if (body.member && typeof body.member === "object" && (body.member.name ?? "").trim()) {
    // castMembers 한 명 패치(포트레이트 재편집). 빈 문자열 필드는 무시(지우기 아님 — 단순 패치).
    const name = (body.member.name as string).trim();
    const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const patch: Partial<CastMember> = {
      ...(clean(body.member.archetype) ? { archetype: clean(body.member.archetype) } : {}),
      ...(body.member.faceSource === "upload" || body.member.faceSource === "generate"
        ? { faceSource: body.member.faceSource }
        : {}),
      ...(clean(body.member.faceUploadUrl) ? { faceUploadUrl: clean(body.member.faceUploadUrl) } : {}),
      ...(clean(body.member.faceDesc) ? { faceDesc: clean(body.member.faceDesc) } : {}),
      ...(clean(body.member.portraitUrl) ? { portraitUrl: clean(body.member.portraitUrl) } : {}),
      ...(clean(body.member.voiceId) ? { voiceId: clean(body.member.voiceId) } : {}),
    };
    // castMembers 없던 구 프로젝트는 cast 이름들로 시드.
    const members: CastMember[] = project.castMembers?.length
      ? [...project.castMembers]
      : (project.cast ?? []).map((n) => ({ name: n }));
    const idx = members.findIndex((mm) => mm.name === name);
    if (idx >= 0) members[idx] = { ...members[idx], ...patch };
    else members.push({ name, ...patch });
    project.castMembers = members;
    // cast 미러 유지 — 새 인물이면 이름 목록에도 추가.
    if (!project.cast?.includes(name)) project.cast = [...(project.cast ?? []), name];
  } else {
    return NextResponse.json({ ok: false, error: "rename, cast 또는 member 필요" }, { status: 400 });
  }

  project.updatedAt = Date.now();
  await saveProject(project);
  return NextResponse.json({
    ok: true,
    cast: project.cast ?? [],
    castVoices: project.castVoices ?? {},
    castMembers: project.castMembers ?? [],
  });
}
