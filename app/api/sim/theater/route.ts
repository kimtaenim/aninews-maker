import { NextRequest, NextResponse } from "next/server";
import { createSimTheater } from "@/lib/simTheaterStore";
import { getSessionEmail } from "@/lib/auth";
import type { TheaterCast } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;

// AI 자동극장 생성 — 출연진(2~3명)과 시작 상황을 받아 저장.
// body: { title?, situation?, cast: [{ name, archetype?, persona, portraitUrl?, faces? }] }
export async function POST(req: NextRequest) {
  let body: { title?: string; situation?: string; cast?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const raw = Array.isArray(body.cast) ? body.cast : [];
  const cast: TheaterCast[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    const name = String(o.name ?? "").trim();
    const persona = String(o.persona ?? "").trim();
    if (!name || !persona) continue;
    const faces =
      o.faces && typeof o.faces === "object"
        ? (Object.fromEntries(
            Object.entries(o.faces as Record<string, unknown>).filter(
              ([, v]) => typeof v === "string" && (v as string).startsWith("http")
            )
          ) as Record<string, string>)
        : undefined;
    cast.push({
      name,
      archetype: String(o.archetype ?? "").trim() || undefined,
      persona,
      portraitUrl:
        typeof o.portraitUrl === "string" && o.portraitUrl.startsWith("http")
          ? o.portraitUrl
          : undefined,
      ...(faces && Object.keys(faces).length ? { faces } : {}),
    });
  }

  if (cast.length < 2 || cast.length > 3) {
    return NextResponse.json(
      { ok: false, error: "출연진은 2~3명이어야 해요" },
      { status: 400 }
    );
  }
  if (new Set(cast.map((c) => c.name)).size !== cast.length) {
    return NextResponse.json({ ok: false, error: "인물 이름이 겹쳐요" }, { status: 400 });
  }

  const theater = await createSimTheater({
    title:
      (body.title ?? "").trim() || `🎭 ${cast.map((c) => c.name).join(" · ")}`,
    situation: (body.situation ?? "").trim(),
    cast,
    ownerEmail: (await getSessionEmail()) ?? undefined,
  });
  return NextResponse.json({ ok: true, theaterId: theater.id });
}
