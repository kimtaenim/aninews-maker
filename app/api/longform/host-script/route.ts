import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getProject, getProjectsBulk, saveProject, emptySteps } from "@/lib/projectStore";
import { generateHostScript, type HostSceneDraft } from "@/lib/longformHost";
import { estimateDuration } from "@/lib/scenes";
import { getSessionEmail } from "@/lib/auth";
import type { Project, Scene } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

// 롱폼 진행자 대본 생성 — 세그먼트 스크립트를 읽어 오프닝·연결·마무리를 만들고, 그것을 담은
// 별도 "진행자 프로젝트"를 생성/갱신한다(Studio 에서 세그먼트처럼 씬별 편집). 롱폼은
// hostProjectId 로 이 프로젝트를 참조하고, 합성 때 슬롯대로 세그먼트와 교차한다.
//   POST { projectId }  → { ok, hostProjectId, counts }
export async function POST(req: NextRequest) {
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

  const longform = await getProject(projectId);
  if (!longform) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  const segIds = longform.sourceProjectIds ?? [];
  if (segIds.length < 2) {
    return NextResponse.json({ ok: false, error: "세그먼트가 2개 이상이어야 해요" }, { status: 422 });
  }

  // 세그먼트별 합친 나레이션 수집(순서 유지).
  const segProjects = await getProjectsBulk(segIds);
  const byId = new Map(segProjects.map((s) => [s.id, s]));
  const segments = segIds
    .map((id) => byId.get(id))
    .filter((s): s is NonNullable<typeof s> => !!s)
    .map((s) => ({
      title: s.title,
      narration: (s.scenes ?? []).map((sc) => sc.narration).filter(Boolean).join(" "),
    }));

  try {
    const { opening: openingScenes, connectors, closing } = await generateHostScript({
      projectId,
      segments,
      opening: longform.opening?.openLoop ?? null, // [호응] 오프닝 선언 고리를 따르게
    });

    // 호스트 씬 배열 — 오프닝 → 연결(connectorAfter=i) → 마무리. 씬0(첫 오프닝)=캐릭터 키프레임.
    const scenes: Scene[] = [];
    let idx = 0;
    const mk = (d: HostSceneDraft, hostSlot: Scene["hostSlot"], connectorAfter?: number): Scene => ({
      index: idx++,
      narration: d.narration,
      imagePrompt: d.imagePrompt,
      motion: "",
      durationSec: estimateDuration(d.narration),
      status: "generated",
      hostSlot,
      ...(connectorAfter !== undefined ? { connectorAfter } : {}),
    });
    // 진행자: 오프닝(전체 훅) → 세그먼트마다 뒤에 연결(connectorAfter=i) → 마지막 뒤 마무리(구독·좋아요).
    for (const d of openingScenes) scenes.push(mk(d, "opening"));
    connectors.forEach((d, i) => scenes.push(mk(d, "connector", i)));
    for (const d of closing) scenes.push(mk(d, "closing"));

    const now = Date.now();
    const steps = emptySteps();
    steps.source.status = "approved";
    steps.source.updatedAt = now;
    steps.script.status = "approved"; // 대본 확정 — 다음은 키프레임부터
    steps.script.updatedAt = now;

    // 기존 진행자 프로젝트가 있으면 갱신(씬 교체 + 파이프라인 리셋), 없으면 새로.
    const existingId = longform.hostProjectId;
    const existing = existingId ? await getProject(existingId) : null;
    const ownerEmail = (await getSessionEmail()) ?? longform.ownerEmail;

    const hostId = existing?.id ?? randomUUID();
    const hostProject: Project = {
      id: hostId,
      title: `${longform.title} · 진행자`,
      format: "long",
      longformId: longform.id,
      styleProfileId: longform.styleProfileId,
      styleBible: longform.styleBible,
      keyframeUrl: undefined, // 오프닝 첫 씬에서 새로 확정
      scenes,
      steps,
      ttsEnabled: longform.ttsEnabled ?? true,
      ttsProvider: longform.ttsProvider,
      voiceId: longform.voiceId,
      voiceSpeed: longform.voiceSpeed,
      videoModelId: longform.videoModelId,
      subtitle: longform.subtitle,
      watermark: longform.watermark,
      ownerEmail: ownerEmail ?? undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await saveProject(hostProject);

    // 롱폼에 hostProjectId 기록(저장 직전 fresh 재읽기 후 필드만 머지).
    const fresh = (await getProject(projectId)) ?? longform;
    fresh.hostProjectId = hostId;
    fresh.updatedAt = now;
    await saveProject(fresh);

    return NextResponse.json({
      ok: true,
      hostProjectId: hostId,
      counts: { opening: openingScenes.length, connectors: connectors.length, closing: closing.length },
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "진행자 대본 생성 실패" },
      { status: 500 }
    );
  }
}
