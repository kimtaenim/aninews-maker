import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { synthesize } from "@/lib/tts";
import { canStart } from "@/lib/stepMachine";
import { uploadAsset } from "@/lib/blob";
import { formatKrw, recordCost } from "@/lib/cost";
import { getLang, isTargetLang, dubNarration, dubAudioUrl } from "@/lib/languages";

export const runtime = "nodejs";
export const maxDuration = 60; // TTS 는 동기·짧음

// 6. voiceover — 씬 나레이션 → TTS(mp3) → Blob 저장. 동기 호출이라 GET 폴링 없음.
// body: { projectId, sceneIndex, text?, lang? }
// lang="ko"(기본)는 한국어판(단계 상태 이동). 그 외(en/es/ja…)는 다국어판 더빙:
// dub[lang].narration → dub[lang].audioUrl 에 저장(한국어 단계 상태는 안 건드림).
export async function POST(req: NextRequest) {
  let body: { projectId?: string; sceneIndex?: number; text?: string; lang?: string };
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
  // lang="ko"(또는 미지정) → 한국어판. 그 외 등록 언어 → 다국어판 더빙.
  const isDub = isTargetLang(body.lang);
  const lang = isDub ? (body.lang as string) : "ko";
  const langDef = isDub ? getLang(lang) : undefined;
  // 한국어 음성은 ttsScript(음성 전용 오버라이드)가 있으면 그걸, 없으면 narration(자막)을 쓴다.
  // 다국어판은 해당 언어 번역(dub[lang].narration)을 쓴다.
  // 클라이언트가 text 를 명시하면 항상 그게 우선(기존 동작 유지).
  const base = isDub
    ? dubNarration(scene, lang)
    : scene?.ttsScript?.trim() || scene?.narration;
  const text = (body.text ?? base ?? "").trim();
  if (!text) {
    return NextResponse.json(
      {
        ok: false,
        error: isDub
          ? `씬${sceneIndex + 1} ${langDef?.label ?? lang} 스크립트가 없어요 (번역 먼저)`
          : `씬${sceneIndex + 1} 나레이션이 없어요`,
      },
      { status: 422 }
    );
  }

  // 한국어판만 voiceover 단계 상태를 움직인다. 다국어판은 별도 트랙.
  if (!isDub) {
    project.steps.voiceover.status = "generating";
    project.steps.voiceover.updatedAt = Date.now();
    await saveProject(project);
  }

  try {
    const { audioBuffer, costUsd, vendor, model } = await synthesize({
      text,
      lang,
      provider: project.ttsProvider,
    });
    const { url } = await uploadAsset(
      `project/${projectId}/scene-${sceneIndex}-audio-${lang}-${Date.now()}.mp3`,
      Buffer.from(audioBuffer),
      "audio/mpeg"
    );
    project.scenes[sceneIndex] = isDub
      ? { ...scene, dub: { ...scene.dub, [lang]: { ...scene.dub?.[lang], audioUrl: url } } }
      : { ...scene, audioUrl: url, status: "generated" };

    const allDone = isDub
      ? project.scenes.every((s) => !!dubAudioUrl(s, lang))
      : project.scenes.every((s) => !!s.audioUrl);
    if (!isDub) {
      project.steps.voiceover.status = allDone ? "generated" : "generating";
      project.steps.voiceover.updatedAt = Date.now();
    }
    project.updatedAt = Date.now();
    await saveProject(project);

    await recordCost({
      projectId,
      vendor,
      model,
      costUsd,
      meta: { kind: "voiceover", sceneIndex, chars: text.length, lang },
    });

    return NextResponse.json({ ok: true, url, sceneIndex, lang, allDone, cost: formatKrw(costUsd) });
  } catch (e) {
    const error = e instanceof Error ? e.message : "음성 생성 실패";
    project.steps.voiceover.status = "error";
    project.steps.voiceover.error = error;
    project.steps.voiceover.updatedAt = Date.now();
    await saveProject(project);
    const hint = /API_KEY|401|unauthor/i.test(error)
      ? " (TTS_PROVIDER 에 맞는 API 키가 .env.local 에 있는지 확인해주세요)"
      : "";
    return NextResponse.json({ ok: false, error: error + hint }, { status: 500 });
  }
}
