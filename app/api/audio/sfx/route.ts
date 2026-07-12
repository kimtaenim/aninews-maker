import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateSoundEffect } from "@/lib/elevenlabs";
import { uploadAsset } from "@/lib/blob";
import { getAnthropic, MODELS } from "@/lib/anthropic";

export const runtime = "nodejs";
export const maxDuration = 60;

// 효과음 생성기는 영어 설명에서 잘 나온다 — 한글이면 짧은 영어 사운드 프롬프트로 번역.
async function toEnglishSfx(text: string): Promise<string> {
  if (!/[가-힣]/.test(text)) return text; // 이미 영어면 그대로
  try {
    const client = getAnthropic();
    const r = await client.messages.create({
      model: MODELS.haiku,
      max_tokens: 40,
      system:
        "Convert the given sound description into ONE short, concrete English phrase for a " +
        "text-to-sound-effects generator (e.g. 'rain falling', 'thunder crack', 'heartbeat thump', " +
        "'door creak'). Return ONLY the English phrase — no quotes, no explanation.",
      messages: [{ role: "user", content: text }],
    });
    const out = r.content
      .filter((b: { type: string }) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    return out || text;
  } catch {
    return text; // 번역 실패 시 원문으로 시도
  }
}

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
    const enText = await toEnglishSfx(text); // 생성은 영어로, 표시(scene.sfx)는 원문 그대로
    const { audioBuffer } = await generateSoundEffect({ text: enText, durationSec: body.durationSec });
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
