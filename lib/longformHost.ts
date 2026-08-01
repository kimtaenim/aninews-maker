// ============================================================================
// 롱폼 진행자 대본 → 씬. 대본을 쓰거나 고치면 씬은 자동으로 따라온다.
// ----------------------------------------------------------------------------
// ★ "씬 펼치기"는 사용자가 눌러야 하는 단계가 아니다(2026-08-01 사용자 지적).
//   숏폼은 대본을 쓰면 씬이 그냥 있다 — 롱폼도 같아야 한다. 그래서 대본 저장 경로에서
//   이 함수를 부른다. 화면에 "진행자 씬"이라는 말이 나올 이유가 없어진다.
// ============================================================================

import { randomUUID } from "crypto";
import { getProject, saveProject, emptySteps } from "./projectStore";
import { speakSeconds } from "./longformScreening";
import type { Project, Scene, LongformScriptPackage } from "./types";

// 대본 패키지를 진행자 프로젝트의 씬으로 펼친다. 기존 프로젝트가 있으면 씬만 갈아끼운다.
//   오프닝 블록 A·B      → hostSlot "opening"
//   연결 i              → hostSlot "connector", connectorAfter=i
//   엔딩 답·(여운)·구독  → hostSlot "closing"
export async function syncHostScenes(
  projectId: string,
  ownerEmailArg?: string | null
): Promise<{ hostProjectId: string; counts: { opening: number; connectors: number; closing: number } } | null> {
  const longform = await getProject(projectId);
  if (!longform) return null;
  const pkg: LongformScriptPackage | undefined = longform.longformScript;
  if (!pkg) return null;

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
  const ownerEmail = ownerEmailArg ?? longform.ownerEmail;

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

  return {
    hostProjectId: hostId,
    counts: { opening: 2, connectors: pkg.bridges.length, closing: hasLanding ? 3 : 2 },
  };
}
