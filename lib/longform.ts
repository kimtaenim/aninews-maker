// ============================================================================
// 롱폼 묶기 — 선택한 숏폼 4~12편을 가로 16:9 롱폼으로 묶는다.
// ----------------------------------------------------------------------------
// 설계(합의):
//  · 롱폼 = 세그먼트(숏폼을 16:9로 재합성한 별도 프로젝트)들의 완성본을 이어붙인 것.
//    합치기 자체는 워커 runLongformConcat 이 담당(세그먼트 finalVideoUrl + 아이캐치 concat).
//  · 세그먼트 = 숏폼 한 편을 16:9 로 재생성한 프로젝트. 대본·음성은 재활용, 이미지·영상만
//    16:9 로 다시(기존 그림을 레퍼런스로). 구독 마무리씬은 빼고 굽는다(구독 유도는
//    세그먼트 사이 아이캐치가 대신). longformId 로 롱폼에 귀속 → 라이브러리 폴더로 묶임.
//  · 무거운 재생성(키프레임→이미지→영상→합성)은 세그먼트 각자(기존 파이프라인)가 처리.
// 이 파일은 "묶기"의 셋업만 한다 — 세그먼트·롱폼 프로젝트를 만들어 저장. 재생성 구동은
// 기존 스튜디오 파이프라인, 최종 이어붙이기는 /api/compose → 워커.
// ============================================================================

import { randomUUID } from "crypto";
import { emptySteps, saveProject, getProject } from "./projectStore";
import { hasSubscribeOutro } from "./outro";
import type { Project, Scene, StepKind, StepState } from "./types";

const MIN_SEGMENTS = 2;
const MAX_SEGMENTS = 12;

function stepAt(kind: StepKind, status: StepState["status"], now: number): StepState {
  return { kind, status, params: {}, chat: [], updatedAt: now };
}

// 숏폼 한 편 → 16:9 세그먼트 프로젝트. 대본·음성 재활용, 이미지·영상은 재생성 대기.
// 구독 마무리씬 제외. 0번 씬 이미지는 키프레임이 담당하므로 reference 대상은 1번+.
export function buildSegment(short: Project, longformId: string, ownerEmail?: string): Project {
  const now = Date.now();

  // 구독 마무리씬 제외 — 마지막 씬이 구독/좋아요 유도면 뺀다.
  let src = short.scenes ?? [];
  if (hasSubscribeOutro(src)) src = src.slice(0, -1);

  const scenes: Scene[] = src.map((s, i) => ({
    index: i,
    narration: s.narration,
    lines: s.lines,
    speaker: s.speaker,
    emotion: s.emotion,
    voiceId: s.voiceId,
    ttsSpeed: s.ttsSpeed,
    ttsScript: s.ttsScript,
    imagePrompt: s.imagePrompt,
    motion: s.motion,
    durationSec: s.durationSec,
    captionStyle: s.captionStyle,
    mood: s.mood,
    sfx: s.sfx,
    sfxUrl: s.sfxUrl,
    sfxVolume: s.sfxVolume,
    // 음성 재활용(세로/가로 무관) — 재더빙 불필요. 자막 타이밍도 그대로.
    audioUrl: s.audioUrl,
    dub: s.dub,
    ttsTimestamps: s.ttsTimestamps,
    paletteHint: s.paletteHint,
    // 이미지·영상은 16:9 로 재생성. 0번 씬은 키프레임이 만들고(그 키프레임이 원본 9:16
    // 키프레임을 레퍼런스로), 1번+ 씬은 각자 원본 그림을 레퍼런스로 16:9 재생성.
    imageSource: i === 0 ? "generate" : "reference",
    referenceImageUrl: i === 0 ? undefined : s.imageUrl,
    status: "generated",
    skipped: s.skipped,
  }));

  const steps = emptySteps();
  steps.source = stepAt("source", "approved", now);
  steps.script = stepAt("script", "approved", now);
  steps.keyframe = stepAt("keyframe", "pending", now); // 16:9 키프레임 재생성 필요
  steps.images = stepAt("images", "pending", now); // 16:9 씬 이미지 재생성
  steps.videos = stepAt("videos", "pending", now); // 16:9 영상 재생성
  steps.voiceover = stepAt("voiceover", "approved", now); // 음성 재활용 — 재생성 불필요
  steps.compose = stepAt("compose", "pending", now);

  return {
    id: randomUUID(),
    title: `${short.title} · 가로판`,
    ...(short.mode ? { mode: short.mode } : {}),
    ...(short.cast?.length ? { cast: short.cast } : {}),
    ...(short.castMembers?.length ? { castMembers: short.castMembers } : {}),
    ...(short.castVoices && Object.keys(short.castVoices).length ? { castVoices: short.castVoices } : {}),
    format: "long",
    longformId,
    styleProfileId: short.styleProfileId,
    styleBible: short.styleBible,
    // 기존 9:16 키프레임을 16:9 키프레임 재생성 레퍼런스로(같은 인물·화풍 유지).
    keyframeReferenceUrl: short.keyframeUrl,
    scenes,
    steps,
    ttsEnabled: short.ttsEnabled,
    ttsProvider: short.ttsProvider,
    voiceId: short.voiceId,
    castVoices: short.castVoices,
    voiceSpeed: short.voiceSpeed,
    videoModelId: short.videoModelId,
    videoCommonPrompt: short.videoCommonPrompt,
    subtitle: short.subtitle,
    watermark: short.watermark,
    credit: short.credit,
    userPrompt: short.userPrompt,
    ownerEmail: ownerEmail ?? short.ownerEmail,
    createdAt: now,
    updatedAt: now,
  };
}

// 선택한 숏폼들로 롱폼 셋업 — 세그먼트 N개 + 롱폼 프로젝트를 만들어 저장한다.
// 반환: 만들어진 롱폼 id 와 세그먼트 id들(순서대로). 재생성·합성은 이후 단계.
export async function createLongformFromShorts(
  shortIds: string[],
  ownerEmail?: string
): Promise<{ longformId: string; segmentIds: string[] }> {
  const ids = shortIds.map((s) => s.trim()).filter(Boolean);
  if (ids.length < MIN_SEGMENTS) throw new Error(`최소 ${MIN_SEGMENTS}편 이상 골라주세요`);
  if (ids.length > MAX_SEGMENTS) throw new Error(`최대 ${MAX_SEGMENTS}편까지 묶을 수 있어요`);

  const shorts: Project[] = [];
  for (const id of ids) {
    const p = await getProject(id);
    if (!p) throw new Error(`숏폼을 찾을 수 없어요: ${id}`);
    if (!p.scenes?.length) throw new Error(`스크립트가 없는 숏폼이 있어요: ${p.title}`);
    shorts.push(p);
  }

  const longformId = randomUUID();
  const segments = shorts.map((s) => buildSegment(s, longformId, ownerEmail));
  for (const seg of segments) await saveProject(seg);

  const now = Date.now();
  const steps = emptySteps();
  // 롱폼 자체는 씬이 없다(세그먼트가 담당) — 재생성 단계들은 approved 로 스킵, 합성만 대기.
  for (const k of ["source", "script", "keyframe", "images", "videos", "voiceover"] as StepKind[]) {
    steps[k] = stepAt(k, "approved", now);
  }
  steps.compose = stepAt("compose", "pending", now);

  const longform: Project = {
    id: longformId,
    title: `${shorts[0].title} 외 ${shorts.length - 1}편 · 롱폼`,
    format: "long",
    sourceProjectIds: segments.map((s) => s.id),
    styleProfileId: shorts[0].styleProfileId,
    styleBible: shorts[0].styleBible,
    scenes: [],
    steps,
    ttsEnabled: false,
    videoModelId: shorts[0].videoModelId,
    subtitle: shorts[0].subtitle,
    watermark: shorts[0].watermark,
    credit: shorts[0].credit,
    ownerEmail: ownerEmail ?? shorts[0].ownerEmail,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(longform);

  return { longformId, segmentIds: segments.map((s) => s.id) };
}
