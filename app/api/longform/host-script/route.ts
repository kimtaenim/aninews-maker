import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getProject, saveProject, emptySteps } from "@/lib/projectStore";
import { speakSeconds } from "@/lib/longformScreening";
import { getSessionEmail } from "@/lib/auth";
import type { Project, Scene, LongformScriptPackage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// [롱폼] 진행자 씬 만들기 — 모듈 2~4가 만든 대본 패키지(longformScript)를 진행자 프로젝트의
// 씬으로 펼친다. 씬 매핑(확정):
//   오프닝 블록 A·B      → hostSlot "opening" 2씬 (첫 씬 = 두 마스코트 확정샷 = 키프레임)
//   브리지 i(방점·승격·개방) → hostSlot "connector", connectorAfter=i (세그먼트 i 뒤)
//   엔딩 파트 A·B·C      → hostSlot "closing" 3씬 (마지막 = 구독 전환)
// 대본이 없으면 422 — 모듈 2~4(/api/longform/script)를 먼저 돌려야 한다.
//   POST { projectId } → { ok, hostProjectId, counts }
export async function POST(req: NextRequest) {
  let body: { projectId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });

  const longform = await getProject(projectId);
  if (!longform) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });

  const pkg: LongformScriptPackage | undefined = longform.longformScript;
  if (!pkg) {
    return NextResponse.json(
      { ok: false, error: "대본이 없어요 — 오프닝·브리지·엔딩(모듈 2~4)을 먼저 생성해주세요" },
      { status: 422 }
    );
  }

  const MASCOTS =
    "The two host mascots (fanged glasses chibi girl + small headless quadruped robot), bright pop background.";
  const scenes: Scene[] = [];
  let idx = 0;
  const mk = (
    narration: string,
    imagePrompt: string | undefined,
    hostSlot: Scene["hostSlot"],
    connectorAfter?: number
  ): Scene => ({
    index: idx++,
    narration,
    imagePrompt: (imagePrompt ?? "").trim() || MASCOTS,
    motion: "",
    durationSec: Math.max(3, Math.round(speakSeconds(narration))),
    status: "generated",
    hostSlot,
    ...(connectorAfter !== undefined ? { connectorAfter } : {}),
  });

  // 오프닝 2씬 — 블록 A(제목 호응 훅) · 블록 B(로드맵 + 착지).
  scenes.push(
    mk(
      pkg.opening.blockAHook,
      pkg.opening.imagePromptA ??
        "The two host mascots, full-body establishing shot, cheerfully opening the show. " + MASCOTS,
      "opening"
    )
  );
  scenes.push(mk(pkg.opening.blockBRoadmapLanding, pkg.opening.imagePromptB, "opening"));

  // 브리지 — 방점·승격·개방을 한 씬 나레이션으로 잇는다(세그먼트 i 뒤).
  for (const b of pkg.bridges) {
    const narration = [b.emphasis, b.elevation, b.opening].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
    if (!narration) continue;
    scenes.push(mk(narration, b.imagePrompt, "connector", b.afterSegment));
  }

  // 엔딩 — 파트 A(고리 닫기) · B(여운, 보통 빈칸) · C(구독 전환).
  // ★ 여운은 기본이 빈 문자열이다(투자 조언 금지). 비어 있으면 씬을 만들지 않는다 —
  // 만들면 대사 없는 3초 정지 화면이 엔딩에 끼어든다(연결과 같은 처리).
  scenes.push(mk(pkg.ending.partAClose, pkg.ending.imagePromptA, "closing"));
  const hasLanding = (pkg.ending.partBLanding ?? "").trim().length > 0;
  if (hasLanding) scenes.push(mk(pkg.ending.partBLanding, pkg.ending.imagePromptB, "closing"));
  scenes.push(
    mk(
      pkg.ending.partCStandard,
      pkg.ending.imagePromptC ?? "The two host mascots pointing at a red subscribe button, cheering. " + MASCOTS,
      "closing"
    )
  );

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
    counts: { opening: 2, connectors: pkg.bridges.length, closing: hasLanding ? 3 : 2 },
  });
}
