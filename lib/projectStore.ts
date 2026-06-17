// ============================================================================
// 프로젝트 상태 저장소 (Redis) — cardnews briefingStore 대응 (골격)
// ----------------------------------------------------------------------------
// 프로젝트 단위 상태(단계머신·씬·StepChat 로그)를 Redis 에 저장. 에셋(이미지/
// 영상/오디오) 자체는 blob.ts 로, 여기엔 URL 만 들고 있는다.
// ============================================================================

import { randomUUID } from "crypto";
import { getRedis } from "./redis";
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
}

// 1단계 소스 캡처 = 프로젝트 생성. 소스 재료는 steps.source.params 에 담고
// source 단계를 "generated"(검수 대기)로 둔다. styleBible 은 프로필 image_bible
// 에서 시작해 keyframe 단계에서 확정·갱신된다.
export async function createProject(args: CreateProjectArgs): Promise<Project> {
  const { material, styleProfileId, videoModelId, ttsEnabled } = args;
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
    videoModelId,
    subtitle: DEFAULT_SUBTITLE,
    createdAt: now,
    updatedAt: now,
  };
  await saveProject(project);
  return project;
}

export async function getProject(id: string): Promise<Project | null> {
  return (await getRedis().get<Project>(KEY(id))) ?? null;
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

export async function deleteProject(id: string): Promise<void> {
  const redis = getRedis();
  await redis.del(KEY(id));
  await redis.zrem(INDEX, id);
}
