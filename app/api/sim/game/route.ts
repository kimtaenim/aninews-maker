import { NextRequest, NextResponse } from "next/server";
import { createSimGame, getCachedFaces, faceCacheSig } from "@/lib/simStore";
import { getProject, getProjectsBulk } from "@/lib/projectStore";
import { getSessionEmail } from "@/lib/auth";
import type { CastMember, SimCutscene, SimTarget } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// 시뮬 게임 생성. 클라이언트는 참조(이름·projectId)만 보내고, 포트레이트·목소리·
// 컷씬 영상 URL 스냅샷은 서버가 원본 프로젝트를 다시 읽어 뜬다 — 클라이언트가
// 들고 있던 낡은 URL 이 굳는 걸 막는다.
// body: {
//   title?: string,
//   sourceProjectId: string,
//   targets: [{ name, persona, cutscenes?: [{ at: 25|50|75, projectId }] }]
// }
export async function POST(req: NextRequest) {
  let body: {
    title?: string;
    sourceProjectId?: string;
    protagonist?: unknown;
    scenario?: unknown;
    targets?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  // sourceProjectId 는 선택 — 있으면 클리셰 인물(포트레이트·목소리)을 가져오고,
  // 없으면 제조기에서 직접 만든 인물(이름·아키타입만)로 게임을 만든다.
  const sourceProjectId = (body.sourceProjectId ?? "").trim();
  let members: CastMember[] = [];
  if (sourceProjectId) {
    const source = await getProject(sourceProjectId);
    if (!source) {
      return NextResponse.json({ ok: false, error: "원본 프로젝트 없음" }, { status: 404 });
    }
    members = source.castMembers ?? [];
  }

  const rawTargets = (Array.isArray(body.targets) ? body.targets : []).filter(
    (t): t is Record<string, unknown> => !!t && typeof t === "object"
  );
  if (rawTargets.length === 0) {
    return NextResponse.json({ ok: false, error: "상대를 한 명 이상 골라주세요" }, { status: 400 });
  }

  // 컷씬 원본 프로젝트를 한 번에 로드해 videoUrl 스냅샷.
  const cutsceneProjectIds = [
    ...new Set(
      rawTargets.flatMap((t) =>
        (Array.isArray(t.cutscenes) ? t.cutscenes : [])
          .map((c) => (c && typeof c === "object" ? String((c as Record<string, unknown>).projectId ?? "").trim() : ""))
          .filter(Boolean)
      )
    ),
  ];
  const cutsceneProjects = await getProjectsBulk(cutsceneProjectIds);
  const byId = new Map(cutsceneProjects.map((p) => [p.id, p]));

  const targets: SimTarget[] = [];
  for (const t of rawTargets) {
    const name = String(t.name ?? "").trim();
    const persona = String(t.persona ?? "").trim();
    if (!name) {
      return NextResponse.json({ ok: false, error: "상대 이름이 비었어요" }, { status: 400 });
    }
    if (!persona) {
      return NextResponse.json(
        { ok: false, error: `"${name}" 페르소나가 비었어요 — 생성하거나 직접 입력해주세요` },
        { status: 400 }
      );
    }
    const member = members.find((m) => m.name === name);
    // 아키타입: 클리셰 인물이면 member 에서, 직접 만든 인물이면 바디에서.
    const archetype = member?.archetype || String(t.archetype ?? "").trim() || undefined;
    // 주인공(플레이어)과 이 상대의 관계·만남의 계기(선택).
    const relationship = String(t.relationship ?? "").trim() || undefined;

    const cutscenes: SimCutscene[] = [];
    for (const raw of Array.isArray(t.cutscenes) ? t.cutscenes : []) {
      if (!raw || typeof raw !== "object") continue;
      const c = raw as Record<string, unknown>;
      const at = Number(c.at);
      const projectId = String(c.projectId ?? "").trim();
      if (![25, 50, 75].includes(at) || !projectId) continue;
      const p = byId.get(projectId);
      if (!p) {
        return NextResponse.json(
          { ok: false, error: `컷씬 프로젝트를 찾을 수 없어요: ${projectId}` },
          { status: 400 }
        );
      }
      const videoUrl = p.cleanVideoUrl || p.finalVideoUrl;
      if (!videoUrl) {
        return NextResponse.json(
          { ok: false, error: `"${p.title}" 는 아직 완성 영상이 없어요 — 합성까지 끝난 프로젝트만 컷씬으로 쓸 수 있어요` },
          { status: 400 }
        );
      }
      cutscenes.push({ at, projectId, videoUrl, title: p.title });
    }
    cutscenes.sort((a, b) => a.at - b.at);

    // 표정 얼굴 세트. {neutral,smile,...} → URL 만 통과. 캐릭터 캐시(name+archetype)를
    // 먼저 깔고 클라가 보낸 값으로 덮어써 '같은 인물 = 재생성 없이 얼굴 재사용'.
    const faces: Record<string, string> = { ...(await getCachedFaces(faceCacheSig(name, archetype))) };
    const rawFaces = t.faces && typeof t.faces === "object" ? (t.faces as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(rawFaces)) {
      if (typeof v === "string" && v.startsWith("http")) faces[k] = v;
    }

    targets.push({
      name,
      ...(archetype ? { archetype } : {}),
      ...(member?.portraitUrl ? { portraitUrl: member.portraitUrl } : {}),
      ...(member?.voiceId ? { voiceId: member.voiceId } : {}),
      persona,
      ...(relationship ? { relationship } : {}),
      ...(Object.keys(faces).length ? { faces } : {}),
      cutscenes,
    });
  }

  // 주인공(플레이어) 설정 — 이름·성격 둘 다 있어야 유효.
  let protagonist: { name: string; persona: string } | undefined;
  if (body.protagonist && typeof body.protagonist === "object") {
    const p = body.protagonist as Record<string, unknown>;
    const pName = String(p.name ?? "").trim();
    const pPersona = String(p.persona ?? "").trim();
    if (pName && pPersona) protagonist = { name: pName, persona: pPersona };
  }

  // 시나리오 설계(Step3~7) — 문자열/문자열배열만 통과.
  let scenario:
    | { setting?: string; triggers?: string[]; emotionCurve?: string; toneStyle?: string; ending?: string }
    | undefined;
  if (body.scenario && typeof body.scenario === "object") {
    const sc = body.scenario as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
    const triggers = Array.isArray(sc.triggers)
      ? sc.triggers.filter((t): t is string => typeof t === "string" && !!t.trim()).slice(0, 8)
      : undefined;
    const built = {
      setting: str(sc.setting),
      emotionCurve: str(sc.emotionCurve),
      toneStyle: str(sc.toneStyle),
      ending: str(sc.ending),
      ...(triggers && triggers.length ? { triggers } : {}),
    };
    if (Object.values(built).some((v) => v !== undefined)) scenario = built;
  }

  try {
    const game = await createSimGame({
      title:
        (body.title ?? "").trim() ||
        `💞 ${targets.map((t) => t.name).join("·")} 공략`,
      sourceProjectId,
      ...(protagonist ? { protagonist } : {}),
      ...(scenario ? { scenario } : {}),
      targets,
      ownerEmail: (await getSessionEmail()) ?? undefined,
    });
    return NextResponse.json({ ok: true, gameId: game.id });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "생성 실패" },
      { status: 500 }
    );
  }
}
