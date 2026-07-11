import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { synthesize } from "@/lib/tts";
import { canStart } from "@/lib/stepMachine";
import { uploadAsset } from "@/lib/blob";
import { formatKrw, recordCost } from "@/lib/cost";
import { getLang, isTargetLang, dubNarration, dubAudioUrl } from "@/lib/languages";
import { stripMarks } from "@/lib/emphasis";

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
  if (scene?.skipped) {
    return NextResponse.json({ ok: false, error: "건너뛴 씬이에요" }, { status: 422 });
  }
  // lang="ko"(또는 미지정) → 이 프로젝트의 기본(primary) 트랙. 그 외 등록 언어 →
  // [레거시] 같은 프로젝트 안 다국어판 더빙. 다국어 개편 후에는 언어판이 별도
  // 프로젝트라, primary 트랙이라도 voice 는 project.lang(예: vi)으로 합성한다.
  const isDub = isTargetLang(body.lang);
  const lang = isDub ? (body.lang as string) : "ko";
  const langDef = isDub ? getLang(lang) : undefined;
  // 합성 voice 언어: 더빙이면 그 언어, primary 면 프로젝트 콘텐츠 언어(없으면 ko).
  const voiceLang = isDub ? lang : project.lang || "ko";
  // 한국어 음성은 ttsScript(음성 전용 오버라이드)가 있으면 그걸, 없으면 narration(자막)을 쓴다.
  // 다국어판은 해당 언어 번역(dub[lang].narration)을 쓴다.
  // 클라이언트가 text 를 명시하면 항상 그게 우선(기존 동작 유지).
  const base = isDub
    ? dubNarration(scene, lang)
    : scene?.ttsScript?.trim() || scene?.narration;
  // 강조 마커([[..]])는 자막 전용 — 음성 합성 텍스트에서는 뗀다(발음/합성에 안 새게).
  const text = stripMarks((body.text ?? base ?? "").trim());
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
      lang: voiceLang,
      provider: project.ttsProvider,
      // 프로젝트가 고른 목소리 — primary 트랙만. 더빙(다국어)은 언어별 env voice 사용.
      voiceId: isDub ? undefined : project.voiceId,
      speed: project.voiceSpeed ?? 1.2, // 기본 1.2배(미설정 프로젝트도 동일하게).
    });
    const { url } = await uploadAsset(
      `project/${projectId}/scene-${sceneIndex}-audio-${lang}-${Date.now()}.mp3`,
      Buffer.from(audioBuffer),
      "audio/mpeg"
    );
    // 합성 동안(~수 초) 다른 작업(이미지·영상)이 같은 프로젝트를 저장했을 수 있으니,
    // 저장 직전에 최신본을 다시 읽어 audio 필드만 머지한다(병렬 생성 시 상호 덮어쓰기 방지).
    const fresh = (await getProject(projectId)) ?? project;
    const fScene = fresh.scenes[sceneIndex] ?? scene;
    fresh.scenes[sceneIndex] = isDub
      ? { ...fScene, dub: { ...fScene.dub, [lang]: { ...fScene.dub?.[lang], audioUrl: url } } }
      : { ...fScene, audioUrl: url, status: "generated" };

    const allDone = isDub
      ? fresh.scenes.every((s) => s.skipped || !!dubAudioUrl(s, lang))
      : fresh.scenes.every((s) => s.skipped || !!s.audioUrl);
    if (!isDub) {
      fresh.steps.voiceover.status = allDone ? "generated" : "generating";
      fresh.steps.voiceover.updatedAt = Date.now();
    }
    fresh.updatedAt = Date.now();
    await saveProject(fresh);

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
    const fresh = (await getProject(projectId)) ?? project;
    fresh.steps.voiceover.status = "error";
    fresh.steps.voiceover.error = error;
    fresh.steps.voiceover.updatedAt = Date.now();
    await saveProject(fresh);
    const hint = /API_KEY|401|unauthor/i.test(error)
      ? " (TTS_PROVIDER 에 맞는 API 키가 .env.local 에 있는지 확인해주세요)"
      : "";
    return NextResponse.json({ ok: false, error: error + hint }, { status: 500 });
  }
}
