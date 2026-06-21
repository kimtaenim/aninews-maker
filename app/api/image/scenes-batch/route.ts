import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateScene } from "@/lib/image";
import { canStart } from "@/lib/stepMachine";
import { formatKrw } from "@/lib/cost";
import type { ImageQuality } from "@/lib/openai";

export const runtime = "nodejs";
export const maxDuration = 300; // 여러 씬 병렬 생성

const CONCURRENCY = 4; // gpt-image-2 동시 호출 한도(레이트리밋·메모리 보호)

// 동시 한도를 둔 병렬 맵.
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (idx < items.length) {
        const cur = idx++;
        results[cur] = await fn(items[cur]);
      }
    })
  );
  return results;
}

// 4단계 — 여러 씬 이미지를 병렬 생성하고 "한 번만" 저장(동시 저장 경합 없이 빠르게).
// body: { projectId, sceneIndexes: number[], quality? }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; sceneIndexes?: number[]; quality?: ImageQuality };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (!canStart(project, "images")) {
    return NextResponse.json({ ok: false, error: "키프레임 단계를 먼저 승인해주세요" }, { status: 409 });
  }
  if (!project.keyframeUrl) {
    return NextResponse.json({ ok: false, error: "키프레임이 없어요 (3단계 먼저)" }, { status: 409 });
  }

  // 생성 가능한 씬만(씬1+, generate/reference, 프롬프트·참조 충족).
  const keyframeUrl = project.keyframeUrl;
  const wanted = Array.isArray(body.sceneIndexes) ? body.sceneIndexes : [];
  const targets = [...new Set(wanted)].filter((i) => {
    const s = project.scenes[i];
    if (!s || i < 1 || i >= project.scenes.length) return false;
    if (s.imageSource === "upload") return false;
    if (!(s.imagePrompt ?? "").trim()) return false;
    if (s.imageSource === "reference" && !s.referenceImageUrl) return false;
    return true;
  });
  if (targets.length === 0) {
    return NextResponse.json({ ok: false, error: "생성할 씬이 없어요 (프롬프트·참조 확인)" }, { status: 422 });
  }

  // 진행 표시 저장(생성 중).
  project.steps.images.status = "generating";
  project.steps.images.updatedAt = Date.now();
  for (const i of targets) project.scenes[i] = { ...project.scenes[i], status: "generating" };
  await saveProject(project);

  // 병렬 생성(동시 한도). 씬별 실패는 개별 처리(전체 실패 방지).
  const outcomes = await mapLimit(targets, CONCURRENCY, async (i) => {
    const s = project.scenes[i];
    try {
      const { url, costUsd } = await generateScene({
        projectId,
        styleBible: project.styleBible,
        scenePrompt: s.imagePrompt,
        narration: s.narration,
        sceneIndex: i,
        keyframeUrl,
        quality: body.quality,
        referenceImageUrl:
          s.imageSource === "reference" ? s.referenceImageUrl : undefined,
        paletteHint: s.paletteHint,
      });
      return { i, ok: true as const, url, costUsd };
    } catch (e) {
      return { i, ok: false as const, error: e instanceof Error ? e.message : "이미지 생성 실패" };
    }
  });

  // 모든 생성이 끝난 뒤 한 번만 저장 → 병렬 저장 경합 없음.
  const fresh = (await getProject(projectId)) ?? project;
  let totalCost = 0;
  for (const o of outcomes) {
    const sc = fresh.scenes[o.i];
    if (!sc) continue;
    if (o.ok) {
      fresh.scenes[o.i] = { ...sc, imageUrl: o.url, status: "generated" };
      totalCost += o.costUsd;
    } else {
      fresh.scenes[o.i] = { ...sc, status: "error" };
    }
  }
  const allDone = fresh.scenes.length > 1 && fresh.scenes.slice(1).every((s) => !!s.imageUrl);
  fresh.steps.images.status = allDone ? "generated" : "generating";
  fresh.steps.images.error = outcomes.find((o) => !o.ok)?.error;
  fresh.steps.images.updatedAt = Date.now();
  fresh.updatedAt = Date.now();
  await saveProject(fresh);

  return NextResponse.json({
    ok: true,
    results: outcomes.map((o) =>
      o.ok ? { sceneIndex: o.i, url: o.url } : { sceneIndex: o.i, error: o.error }
    ),
    allDone,
    cost: formatKrw(totalCost),
  });
}
