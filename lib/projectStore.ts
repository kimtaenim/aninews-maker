// ============================================================================
// 프로젝트 상태 저장소 (Redis) — cardnews briefingStore 대응 (골격)
// ----------------------------------------------------------------------------
// 프로젝트 단위 상태(단계머신·씬·StepChat 로그)를 Redis 에 저장. 에셋(이미지/
// 영상/오디오) 자체는 blob.ts 로, 여기엔 URL 만 들고 있는다.
// ============================================================================

import { randomUUID } from "crypto";
import { getRedis } from "./redis";
import { listAssets, deleteAsset } from "./blob";
import { getStyleProfile } from "./styleProfiles";
import type { SourceMaterial } from "./source";
import {
  STEP_ORDER,
  DEFAULT_SUBTITLE,
  type Project,
  type StepKind,
  type StepState,
} from "./types";

const KEY = (id: string) => `project:${id}`;
const INDEX = "project:index"; // 최근 프로젝트 목록 (sorted set, score=updatedAt)

export function emptySteps(): Record<StepKind, StepState> {
  const now = 0;
  return Object.fromEntries(
    STEP_ORDER.map((kind) => [
      kind,
      { kind, status: "pending", params: {}, chat: [], updatedAt: now },
    ])
  ) as unknown as Record<StepKind, StepState>;
}

export interface CreateProjectArgs {
  material: SourceMaterial;
  styleProfileId: string;
  videoModelId: string;
  ttsEnabled: boolean;
  userPrompt?: string; // "어떤 식으로 만들까요?" — 스크립트 생성에 주입
  ownerEmail?: string; // 만든 사람(로그인 이메일)
}

// 1단계 소스 캡처 = 프로젝트 생성. 소스 재료는 steps.source.params 에 담고
// source 단계를 "generated"(검수 대기)로 둔다. styleBible 은 프로필 image_bible
// 에서 시작해 keyframe 단계에서 확정·갱신된다.
export async function createProject(args: CreateProjectArgs): Promise<Project> {
  const { material, styleProfileId, videoModelId, ttsEnabled, userPrompt, ownerEmail } = args;
  const profile = getStyleProfile(styleProfileId);
  const now = Date.now();
  const steps = emptySteps();
  steps.source = {
    kind: "source",
    status: "generated",
    params: { material },
    chat: [],
    updatedAt: now,
  };

  const project: Project = {
    id: randomUUID(),
    title: material.title,
    styleProfileId,
    styleBible: profile.imageBible,
    scenes: [],
    steps,
    ttsEnabled,
    ttsProvider: "elevenlabs", // 보이스오버 기본 엔진(env 기본값보다 우선).
    voiceSpeed: 1.2, // 보이스오버 기본 속도 — 빠르게(1.2배).
    videoModelId,
    subtitle: DEFAULT_SUBTITLE,
    userPrompt: userPrompt?.trim() || undefined,
    ownerEmail: ownerEmail?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(project);
  return project;
}

export async function getProject(id: string): Promise<Project | null> {
  const project = (await getRedis().get<Project>(KEY(id))) ?? null;
  return project ? normalizeScene0(project) : null;
}

// 씬0 이미지는 곧 키프레임이다(별도 생성 경로 없음 — image/scene 은 씬1+ 만).
// 편집 저장의 carry 누락·동기화 경합 등으로 scenes[0].imageUrl 만 비고 keyframeUrl 은
// 남는 경우, 5단계(비디오)에서 씬0 이 "이미지 없음" 으로 보이던 버그를 자가보정한다.
// keyframeUrl 이 진실의 원천이므로 비어있는 scenes[0].imageUrl 을 그것으로 채운다.
function normalizeScene0(project: Project): Project {
  const scene0 = project.scenes[0];
  if (project.keyframeUrl && scene0 && !scene0.imageUrl) {
    project.scenes[0] = { ...scene0, imageUrl: project.keyframeUrl };
  }
  return project;
}

export async function saveProject(project: Project): Promise<void> {
  const redis = getRedis();
  await redis.set(KEY(project.id), project);
  await redis.zadd(INDEX, { score: project.updatedAt, member: project.id });
}

export async function listRecentProjects(limit = 30): Promise<string[]> {
  // 최신순
  return getRedis().zrange<string[]>(INDEX, 0, limit - 1, { rev: true });
}

// 워커가 Redis(compose:progress:<id>)에 쓴 합성 진행 로그의 마지막 줄. UI 표시용.
export async function getComposeProgressLine(id: string): Promise<string> {
  try {
    const last = await getRedis().lrange<string>(`compose:progress:${id}`, -1, -1);
    return (last && last[0]) || "";
  } catch {
    return "";
  }
}

export async function deleteProject(id: string): Promise<void> {
  const redis = getRedis();
  // 1) 관련 Blob 자산(키프레임·씬 이미지/영상/오디오·최종영상) 일괄 정리.
  //    모든 자산은 `project/<id>/` prefix 아래에 있어 list+del 한 방에 비운다.
  //    Blob 정리는 베스트에포트 — 실패해도 상태 삭제는 막지 않는다(고아 상태 방지).
  try {
    const { blobs } = await listAssets({ prefix: `project/${id}/` });
    if (blobs.length) {
      await deleteAsset(blobs.map((b) => b.url));
    }
  } catch {
    /* Blob 토큰 없음/일시 오류 — 무시하고 진행 */
  }
  // 2) Redis 상태 + 최근목록 인덱스 제거.
  await redis.del(KEY(id));
  await redis.zrem(INDEX, id);
}
