import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { generateScript, generateClicheScript } from "@/lib/script";
import { canStart } from "@/lib/stepMachine";
import { estimateDuration } from "@/lib/scenes";
import type { Project, Scene } from "@/lib/types";
import type { SourceMaterial } from "@/lib/source";

export const runtime = "nodejs";
// [cliche] 줄별 대사+프롬프트+모션+분위기 씬까지 생성해 Claude 호출이 60초를 넘길 수 있다
// (60이던 시절 Vercel FUNCTION_INVOCATION_TIMEOUT → 클라이언트 "not valid JSON" 에러).
export const maxDuration = 300;

// ── 뉴스 고정 마무리 씬(구독 유도) ───────────────────────────────────────────
// 뉴스 스크립트 생성 때마다 마지막에 붙는다(재생성 포함). 등장인물들이 손 흔들며
// 인사하는 컷 + 이 자막 + 1.4배 목소리. 1.4배는 Typecast 만 가능(ElevenLabs API
// 상한 1.2)이라, 프로젝트 목소리가 Typecast 가 아니면 이 씬만 지정 목소리로 교체.
const OUTRO_NARRATION = "아침 저녁으로 경제 교양 정보를 받아보실 수 있어요. 구독 눌러주세요!";
const OUTRO_TYPECAST_VOICE = "tc_603513d91860484c4dcb6a11"; // 미남 (config/voices.json)

function newsOutroScene(project: Project, index: number): Scene {
  const projectUsesTypecast =
    (project.voiceId ?? "").startsWith("tc_") ||
    (!project.voiceId && project.ttsProvider === "typecast");
  return {
    index,
    narration: OUTRO_NARRATION,
    imagePrompt:
      "영상 속 등장인물들이 함께 카메라를 향해 환하게 웃으며 손을 흔들어 인사하는 밝은 마무리 장면",
    motion:
      "Characters smile warmly and wave goodbye at the camera, gentle push-in, soft bright lighting",
    durationSec: estimateDuration(OUTRO_NARRATION),
    status: "generated",
    ttsSpeed: 1.4,
    ...(projectUsesTypecast ? {} : { voiceId: OUTRO_TYPECAST_VOICE }),
  };
}

// 2. script — 소스에서 씬 배열 생성. body: { projectId, userPrompt? }
// 흐름: 프로젝트 로드 → source 승인 확인 → Claude → scenes[] 저장 →
// steps.script = generated.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; userPrompt?: string };
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
  if (!canStart(project, "script")) {
    return NextResponse.json(
      { ok: false, error: "소스 단계를 먼저 승인해주세요" },
      { status: 409 }
    );
  }

  const material = project.steps.source.params.material as SourceMaterial | undefined;
  if (!material?.body) {
    return NextResponse.json({ ok: false, error: "소스 본문 없음" }, { status: 422 });
  }

  const now = Date.now();
  project.steps.script.status = "generating";
  project.steps.script.updatedAt = now;
  await saveProject(project);

  try {
    // ani-cliché 모드는 로맨스 클리셰 생성기(대사+화자), 뉴스 모드는 기존 생성기.
    const { scenes } =
      project.mode === "cliche"
        ? await generateClicheScript({
            projectId,
            tropes: material.body.split(/[,·\n]/).map((t) => t.trim()).filter(Boolean),
            styleBible: project.styleBible,
            userPrompt: body.userPrompt ?? project.userPrompt,
            cast: project.cast,
          })
        : await generateScript({
            projectId,
            material,
            styleBible: project.styleBible,
            // 명시 userPrompt 우선, 없으면 소스 단계에서 저장한 프로젝트 의도 사용.
            userPrompt: body.userPrompt ?? project.userPrompt,
          });
    // 뉴스 모드: 구독 유도 마무리 씬을 항상 마지막에 추가.
    if (project.mode !== "cliche") {
      scenes.push(newsOutroScene(project, scenes.length));
    }
    project.scenes = scenes;
    project.steps.script.status = "generated";
    project.steps.script.updatedAt = Date.now();
    project.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: true, scenes });
  } catch (e) {
    const error = e instanceof Error ? e.message : "스크립트 생성 실패";
    project.steps.script.status = "error";
    project.steps.script.error = error;
    project.steps.script.updatedAt = Date.now();
    await saveProject(project);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
