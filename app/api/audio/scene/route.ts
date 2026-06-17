import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { synthesizeSpeech } from "@/lib/elevenlabs";
import { canStart } from "@/lib/stepMachine";
import { uploadAsset } from "@/lib/blob";
import { formatKrw, recordCost } from "@/lib/cost";

export const runtime = "nodejs";
export const maxDuration = 60; // TTS 는 동기·짧음

// 6. voiceover — 씬 나레이션 → ElevenLabs TTS(mp3) → Blob 저장. 동기 호출이라
// GET 폴링 없음. body: { projectId, sceneIndex, text? }
export async function POST(req: NextRequest) {
  let body: { projectId?: string; sceneIndex?: number; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  if (!projectId) {
    return NextResponse.json({ ok: false, error: "projectId 필요" }, { status: 400 });
  }
  const sceneIndex = body.sceneIndex;
  if (typeof sceneIndex !== "number" || !Number.isInteger(sceneIndex)) {
    return NextResponse.json({ ok: false, error: "sceneIndex 필요" }, { status: 400 });
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }
  if (!canStart(project, "voiceover")) {
    return NextResponse.json(
      { ok: false, error: "비디오 단계를 먼저 승인해주세요" },
      { status: 409 }
    );
  }
  if (sceneIndex < 0 || sceneIndex >= project.scenes.length) {
    return NextResponse.json({ ok: false, error: "sceneIndex 범위 밖" }, { status: 422 });
  }
  const scene = project.scenes[sceneIndex];
  const text = (body.text ?? scene?.narration ?? "").trim();
  if (!text) {
    return NextResponse.json(
      { ok: false, error: `씬${sceneIndex + 1} 나레이션이 없어요` },
      { status: 422 }
    );
  }

  project.steps.voiceover.status = "generating";
  project.steps.voiceover.updatedAt = Date.now();
  await saveProject(project);

  try {
    const { audioBuffer, costUsd } = await synthesizeSpeech({ text });
    const { url } = await uploadAsset(
      `project/${projectId}/scene-${sceneIndex}-audio-${Date.now()}.mp3`,
      Buffer.from(audioBuffer),
      "audio/mpeg"
    );
    project.scenes[sceneIndex] = { ...scene, audioUrl: url, status: "generated" };

    const allDone = project.scenes.every((s) => !!s.audioUrl);
    project.steps.voiceover.status = allDone ? "generated" : "generating";
    project.steps.voiceover.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await saveProject(project);

    await recordCost({
      projectId,
      vendor: "elevenlabs",
      model: "eleven_multilingual_v2",
      costUsd,
      meta: { kind: "voiceover", sceneIndex, chars: text.length },
    });

    return NextResponse.json({ ok: true, url, sceneIndex, allDone, cost: formatKrw(costUsd) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "음성 생성 실패";
    project.steps.voiceover.status = "error";
    project.steps.voiceover.error = error;
    project.steps.voiceover.updatedAt = Date.now();
    await saveProject(project);
    const hint = /ELEVENLABS_API_KEY|401|unauthor/i.test(error)
      ? " (ELEVENLABS_API_KEY 가 .env.local 에 있는지 확인해주세요)"
      : "";
    return NextResponse.json({ ok: false, error: error + hint }, { status: 500 });
  }
}
