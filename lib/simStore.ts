// ============================================================================
// 시뮬 제조기 상태 저장소 (Redis) — projectStore 패턴을 따른다.
// ----------------------------------------------------------------------------
// simgame:<id>  게임 정의(상대·페르소나·컷씬 스냅샷). simgame:index (sorted set).
// simplay:<id>  플레이 세션(친밀도·대화 이력). simplay:index:<gameId> (sorted set).
// 영상·포트레이트는 URL 스냅샷만 들고 있다(Blob 자산은 원본 프로젝트 소유 —
// 게임 삭제 시 Blob 은 건드리지 않는다).
// ============================================================================

import { randomUUID } from "crypto";
import { getRedis } from "./redis";
import type { SimGame, SimPlay, SimTarget } from "./types";

const GAME_KEY = (id: string) => `simgame:${id}`;
const GAME_INDEX = "simgame:index"; // 최근 게임 목록 (sorted set, score=updatedAt)
const PLAY_KEY = (id: string) => `simplay:${id}`;
const PLAY_INDEX = (gameId: string) => `simplay:index:${gameId}`;

// ── 게임 정의 ────────────────────────────────────────────────────────────────

export interface CreateSimGameArgs {
  title: string;
  sourceProjectId: string;
  targets: SimTarget[];
  ownerEmail?: string;
}

export async function createSimGame(args: CreateSimGameArgs): Promise<SimGame> {
  const now = Date.now();
  const game: SimGame = {
    id: randomUUID(),
    title: args.title,
    sourceProjectId: args.sourceProjectId,
    targets: args.targets,
    ownerEmail: args.ownerEmail?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await saveSimGame(game);
  return game;
}

export async function getSimGame(id: string): Promise<SimGame | null> {
  return (await getRedis().get<SimGame>(GAME_KEY(id))) ?? null;
}

export async function saveSimGame(game: SimGame): Promise<void> {
  const redis = getRedis();
  await redis.set(GAME_KEY(game.id), game);
  await redis.zadd(GAME_INDEX, { score: game.updatedAt, member: game.id });
}

export async function listSimGameIds(limit = 50): Promise<string[]> {
  return getRedis().zrange<string[]>(GAME_INDEX, 0, limit - 1, { rev: true });
}

// mget 배치 로드 — 없는 키(삭제 흔적)는 건너뛴다.
export async function getSimGamesBulk(ids: string[]): Promise<SimGame[]> {
  if (ids.length === 0) return [];
  const redis = getRedis();
  const out: SimGame[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const rows = await redis.mget<(SimGame | null)[]>(...chunk.map(GAME_KEY));
    for (const g of rows) if (g) out.push(g);
  }
  return out;
}

// 게임 삭제 — 딸린 플레이 세션도 함께 정리한다.
export async function deleteSimGame(id: string): Promise<void> {
  const redis = getRedis();
  try {
    const playIds = await redis.zrange<string[]>(PLAY_INDEX(id), 0, -1);
    if (playIds.length) await redis.del(...playIds.map(PLAY_KEY));
    await redis.del(PLAY_INDEX(id));
  } catch {
    /* 플레이 정리는 베스트에포트 — 게임 삭제는 막지 않는다 */
  }
  await redis.del(GAME_KEY(id));
  await redis.zrem(GAME_INDEX, id);
}

// ── 플레이 세션 ──────────────────────────────────────────────────────────────

export async function createSimPlay(args: {
  gameId: string;
  targetName: string;
  nextSituationAtTurn: number; // 첫 상황 발동 턴 — 호출부가 주사위를 굴려 넘긴다
  ownerEmail?: string;
}): Promise<SimPlay> {
  const now = Date.now();
  const play: SimPlay = {
    id: randomUUID(),
    gameId: args.gameId,
    targetName: args.targetName,
    affinity: 20, // 시작 친밀도 — 갓 알게 된 사이
    turns: [],
    milestonesSeen: [],
    situationsUsed: [],
    nextSituationAtTurn: args.nextSituationAtTurn,
    status: "playing",
    ownerEmail: args.ownerEmail?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await saveSimPlay(play);
  return play;
}

export async function getSimPlay(id: string): Promise<SimPlay | null> {
  return (await getRedis().get<SimPlay>(PLAY_KEY(id))) ?? null;
}

export async function saveSimPlay(play: SimPlay): Promise<void> {
  const redis = getRedis();
  await redis.set(PLAY_KEY(play.id), play);
  await redis.zadd(PLAY_INDEX(play.gameId), {
    score: play.updatedAt,
    member: play.id,
  });
}
