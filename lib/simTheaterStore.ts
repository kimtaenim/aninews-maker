// ============================================================================
// AI 자동극장 저장소 (Redis) — simStore 패턴을 따른다.
// simtheater:<id>  극장 정의+진행상태. simtheater:index (sorted set, score=updatedAt).
// ============================================================================

import { randomUUID } from "crypto";
import { getRedis } from "./redis";
import type { SimTheater, TheaterCast, TheaterFeeling } from "./types";

const KEY = (id: string) => `simtheater:${id}`;
const INDEX = "simtheater:index";

// 출연진으로 방향쌍 감정을 초기화한다(서로에 대한 좋음/싫음 = 중립에서 시작).
export function initFeelings(cast: TheaterCast[]): TheaterFeeling[] {
  const out: TheaterFeeling[] = [];
  for (const a of cast) {
    for (const b of cast) {
      if (a.name === b.name) continue;
      out.push({ from: a.name, to: b.name, like: 15, dislike: 20 });
    }
  }
  return out;
}

export async function createSimTheater(args: {
  title: string;
  situation: string;
  cast: TheaterCast[];
  ownerEmail?: string;
}): Promise<SimTheater> {
  const now = Date.now();
  const theater: SimTheater = {
    id: randomUUID(),
    title: args.title,
    situation: args.situation,
    cast: args.cast,
    turns: [],
    feelings: initFeelings(args.cast),
    nextSpeakerIdx: 0,
    ownerEmail: args.ownerEmail?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
  await saveSimTheater(theater);
  return theater;
}

export async function getSimTheater(id: string): Promise<SimTheater | null> {
  return (await getRedis().get<SimTheater>(KEY(id))) ?? null;
}

export async function saveSimTheater(t: SimTheater): Promise<void> {
  const redis = getRedis();
  await redis.set(KEY(t.id), t);
  await redis.zadd(INDEX, { score: t.updatedAt, member: t.id });
}

export async function listSimTheaterIds(limit = 50): Promise<string[]> {
  return getRedis().zrange<string[]>(INDEX, 0, limit - 1, { rev: true });
}

export async function getSimTheatersBulk(ids: string[]): Promise<SimTheater[]> {
  if (ids.length === 0) return [];
  const redis = getRedis();
  const out: SimTheater[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    const rows = await redis.mget<(SimTheater | null)[]>(...chunk.map(KEY));
    for (const t of rows) if (t) out.push(t);
  }
  return out;
}

export async function deleteSimTheater(id: string): Promise<void> {
  const redis = getRedis();
  await redis.del(KEY(id));
  await redis.zrem(INDEX, id);
}
