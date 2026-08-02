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
  // 빈 칸은 씬이 아니다 — 사용자가 칸을 비우면 그 씬은 빠진다(오프닝 1씬으로 줄이기 등).
  const push = (sc: Scene | null) => {
    if (sc) scenes.push(sc);
  };
  const mk = (
    narration: string,
    imagePrompt: string | undefined,
    hostSlot: Scene["hostSlot"],
    connectorAfter?: number
  ): Scene | null =>
    !(narration ?? "").trim()
      ? null
      : {
          index: idx++,
          narration,
          imagePrompt: (imagePrompt ?? "").trim() || MASCOTS,
          motion: "",
          durationSec: Math.max(3, Math.round(speakSeconds(narration))),
          status: "generated",
          hostSlot,
          ...(connectorAfter !== undefined ? { connectorAfter } : {}),
        };

  // 오프닝 2씬 — 블록 A(제목 호응 훅) · 블록 B(로드맵 + 착지).
  push(
    mk(
      pkg.opening.blockAHook,
      pkg.opening.imagePromptA ??
        "The two host mascots, full-body establishing shot, cheerfully opening the show. " + MASCOTS,
      "opening"
    )
  );
  push(mk(pkg.opening.blockBRoadmapLanding, pkg.opening.imagePromptB, "opening"));

  // 브리지 — 방점·승격·개방을 한 씬 나레이션으로 잇는다(세그먼트 i 뒤).
  for (const b of pkg.bridges) {
    const narration = [b.emphasis, b.elevation, b.opening].map((s) => (s ?? "").trim()).filter(Boolean).join(" ");
    if (!narration) continue;
    push(mk(narration, b.imagePrompt, "connector", b.afterSegment));
  }

  // 엔딩 — 파트 A(고리 닫기) · B(여운, 보통 빈칸) · C(구독 전환).
  // ★ 여운은 기본이 빈 문자열이다(투자 조언 금지). 비어 있으면 씬을 만들지 않는다 —
  // 만들면 대사 없는 3초 정지 화면이 엔딩에 끼어든다(연결과 같은 처리).
  push(mk(pkg.ending.partAClose, pkg.ending.imagePromptA, "closing"));
  const hasLanding = (pkg.ending.partBLanding ?? "").trim().length > 0;
  push(mk(pkg.ending.partBLanding, pkg.ending.imagePromptB, "closing"));
  push(
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

  const existingId = longform.hostProjectId;
  const existing = existingId ? await getProject(existingId) : null;
  const ownerEmail = ownerEmailArg ?? longform.ownerEmail;

  // ★ 목소리·자막 기본값은 세그먼트(실제 본문)에서 물려받는다 — 롱폼 껍데기에는 이 설정이
  // 없어서, 진행자만 다른 목소리로 더빙되는 사고가 났다(2026-08-02 "디폴트가 달라서 다 망했어").
  const refSeg = (longform.sourceProjectIds ?? []).length
    ? await getProject(longform.sourceProjectIds![0])
    : null;

  // ★ 씬을 갈아끼우되 만든 자산은 보존한다 — 같은 자리(hostSlot·connectorAfter·slot 내 순번)의
  // 기존 씬에서 그림·영상을 가져오고, 나레이션이 같을 때만 음성도 가져온다.
  // (예전엔 대본 저장마다 전부 리셋 — 그림·영상·음성이 통째로 날아갔다.)
  const slotKey = (sc: Scene, seq: number) => `${sc.hostSlot}#${sc.connectorAfter ?? ""}#${seq}`;
  const oldByKey = new Map<string, Scene>();
  {
    const seq: Record<string, number> = {};
    for (const sc of existing?.scenes ?? []) {
      const base = `${sc.hostSlot}#${sc.connectorAfter ?? ""}`;
      seq[base] = (seq[base] ?? 0) + 1;
      oldByKey.set(slotKey(sc, seq[base] - 1), sc);
    }
  }
  const ttsProvider = longform.ttsProvider ?? refSeg?.ttsProvider;
  const voiceId = longform.voiceId ?? refSeg?.voiceId;
  const voiceSpeed = longform.voiceSpeed ?? refSeg?.voiceSpeed;
  // 목소리 설정이 이전 진행자 프로젝트와 다르면 기존 음성은 전부 낡은 것 — 버리고 다시 뽑게 한다.
  const voiceChanged =
    !!existing &&
    (existing.ttsProvider !== ttsProvider ||
      existing.voiceId !== voiceId ||
      existing.voiceSpeed !== voiceSpeed);
  {
    const seq: Record<string, number> = {};
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      const base = `${sc.hostSlot}#${sc.connectorAfter ?? ""}`;
      seq[base] = (seq[base] ?? 0) + 1;
      const old = oldByKey.get(slotKey(sc, seq[base] - 1));
      if (!old) continue;
      scenes[i] = {
        ...sc,
        imageUrl: old.imageUrl,
        videoUrl: old.videoUrl,
        videoJobId: old.videoJobId,
        videoModelId: old.videoModelId,
        imagePrompt: old.imageUrl ? old.imagePrompt : sc.imagePrompt, // 그림이 있으면 그 프롬프트 유지
        ...(old.narration.trim() === sc.narration.trim() && !voiceChanged
          ? { audioUrl: old.audioUrl, ttsTimestamps: old.ttsTimestamps }
          : {}),
      };
    }
  }

  // ★ 단계 상태는 자산에서 복원 — 씬을 갈아끼워도 그림·영상이 살아 있으면 승인 유지.
  // 초기화해 버리면 음성/영상 라우트 게이트("~단계를 먼저 승인")가 전부 막힌다(2026-08-02 실사고 409).
  const allImg = scenes.length > 0 && scenes.every((sc) => !!sc.imageUrl);
  const allVid = scenes.length > 0 && scenes.every((sc) => !!sc.videoUrl);
  const allAud = scenes.length > 0 && scenes.every((sc) => !!sc.audioUrl);
  if (existing?.keyframeUrl) {
    steps.keyframe.status = "approved";
    steps.keyframe.updatedAt = now;
  }
  if (allImg) {
    steps.images.status = "approved";
    steps.images.updatedAt = now;
  }
  if (allVid) {
    steps.videos.status = "approved";
    steps.videos.updatedAt = now;
  }
  if (allAud) {
    steps.voiceover.status = "approved";
    steps.voiceover.updatedAt = now;
  }

  const hostId = existing?.id ?? randomUUID();
  const hostProject: Project = {
    id: hostId,
    title: `${longform.title} · 진행자`,
    format: "long",
    longformId: longform.id,
    styleProfileId: longform.styleProfileId ?? refSeg?.styleProfileId,
    styleBible: longform.styleBible ?? refSeg?.styleBible,
    keyframeUrl: existing?.keyframeUrl, // 이미 확정한 키프레임은 유지
    scenes,
    steps,
    ttsEnabled: longform.ttsEnabled ?? refSeg?.ttsEnabled ?? true,
    ttsProvider,
    voiceId,
    voiceSpeed,
    videoModelId: longform.videoModelId ?? refSeg?.videoModelId,
    subtitle: longform.subtitle ?? refSeg?.subtitle,
    watermark: longform.watermark ?? refSeg?.watermark,
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
