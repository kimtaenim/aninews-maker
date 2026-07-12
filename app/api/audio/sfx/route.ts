import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateSoundEffect } from "@/lib/elevenlabs";
import { uploadAsset } from "@/lib/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

// [cliche] 효과음 생성 — 씬 설명(예: "빗소리") → ElevenLabs 사운드이펙트 → Blob → scene.sfxUrl.
// body: { projectId, sceneIndex, text, durationSec? }. 합성 때 목소리 밑에 믹싱된다.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; sceneIndex?: number; text?: string; durationSec?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const projectId = (body.projectId ?? "").trim();
  const sceneIndex = body.sceneIndex;
  const text = (body.text ?? "").trim();
  if (!projectId) return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  if (typeof sceneIndex !== "number" || !Number.isInteger(sceneIndex)) {
    return NextResponse.json({ ok: false, error: "sceneIndex 필요" }, { status: 400 });
  }
  if (!text) return NextResponse.json({ ok: false, error: "효과음 설명을 입력해주세요" }, { status: 400 });

  const project = await getProject(projectId);
  if (!project) return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  if (sceneIndex < 0 || sceneIndex >= project.scenes.length) {
    return NextResponse.json({ ok: false, error: "sceneIndex 범위 밖" }, { status: 422 });
  }

  try {
    const { audioBuffer } = await generateSoundEffect({ text, durationSec: body.durationSec });
    const { url } = await uploadAsset(
      `project/${projectId}/scene-${sceneIndex}-sfx-${Date.now()}.mp3`,
      Buffer.from(audioBuffer),
      "audio/mpeg"
    );
    // 병렬 저장 경합 방지 — 최신본 재읽기 후 해당 씬만 머지.
    const fresh = (await getProject(projectId)) ?? project;
    const s = fresh.scenes[sceneIndex] ?? project.scenes[sceneIndex];
    fresh.scenes[sceneIndex] = {
      ...s,
      sfx: text,
      sfxUrl: url,
      sfxVolume: typeof s.sfxVolume === "number" ? s.sfxVolume : 0.35,
    };
    fresh.updatedAt = Date.now();
    await saveProject(fresh);
    return NextResponse.json({ ok: true, url, sceneIndex });
  } catch (e) {
    const error = e instanceof Error ? e.message : "효과음 생성 실패";
    const hint = /API_KEY|401|unauthor/i.test(error)
      ? " (ELEVENLABS_API_KEY 확인 — 효과음은 ElevenLabs 로 생성됩니다)"
      : "";
    return NextResponse.json({ ok: false, error: error + hint }, { status: 500 });
  }
}
