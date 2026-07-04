import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { runKeyframeChat, runSourceChat, runScriptChat } from "@/lib/stepChat";
import { getStyleProfile } from "@/lib/styleProfiles";
import type { StepKind, Scene } from "@/lib/types";
import type { SourceMaterial } from "@/lib/source";
import { estimateDuration } from "@/lib/scenes";

export const runtime = "nodejs";
export const maxDuration = 60;

// StepChat — 단계별 미세조정. body: { projectId, step, userMessage }
// 현재 keyframe 지원: style bible 을 대화로 갱신 → 저장. 이후 "다시 생성"으로 적용.
export async function POST(req: NextRequest) {
  let body: { projectId?: string; step?: StepKind; userMessage?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }

  const projectId = (body.projectId ?? "").trim();
  const userMessage = (body.userMessage ?? "").trim();
  if (!projectId || !userMessage) {
    return NextResponse.json(
      { ok: false, error: "projectId/userMessage 필요" },
      { status: 400 }
    );
  }
  if (body.step !== "keyframe" && body.step !== "source" && body.step !== "script") {
    return NextResponse.json(
      { ok: false, error: "현재는 소스·스크립트·키프레임 단계만 대화 지원" },
      { status: 400 }
    );
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
  }

  // 1단계 소스 대화 — 소스 자료(제목·본문)를 대화로 다듬는다.
  if (body.step === "source") {
    const material = project.steps.source.params?.material as SourceMaterial | undefined;
    if (!material?.body?.trim()) {
      return NextResponse.json({ ok: false, error: "소스 본문이 없어요" }, { status: 422 });
    }
    try {
      const { reply, material: updated } = await runSourceChat({ projectId, material, userMessage });
      const now = Date.now();
      project.steps.source.params = { ...project.steps.source.params, material: updated };
      project.steps.source.chat.push(
        { role: "user", text: userMessage, ts: now },
        { role: "assistant", text: reply, ts: now }
      );
      project.steps.source.updatedAt = now;
      project.updatedAt = now;
      await saveProject(project);
      return NextResponse.json({ ok: true, reply, material: updated, chat: project.steps.source.chat });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "소스 대화 실패" },
        { status: 500 }
      );
    }
  }

  // 2단계 스크립트 대화 — 씬 나레이션을 대화로 수정. 새 나레이션으로 씬을 재구성하되,
  // 같은 index 의 기존 산출물(프롬프트·이미지·영상·음성 등)은 carry 하고, 나레이션이
  // 바뀐 씬의 음성대본 미러(ttsScript)는 비운다(자막→음성 단방향).
  if (body.step === "script") {
    if (project.scenes.length === 0) {
      return NextResponse.json({ ok: false, error: "스크립트가 아직 없어요 (먼저 생성)" }, { status: 422 });
    }
    try {
      const { reply, narrations } = await runScriptChat({
        projectId,
        narrations: project.scenes.map((s) => s.narration),
        userMessage,
      });
      const prev = project.scenes;
      const scenes: Scene[] = narrations
        .map((n, index): Scene => {
          const carry = prev[index];
          const narration = n.trim();
          return {
            ...(carry ?? {}),
            index,
            narration,
            imagePrompt: carry?.imagePrompt ?? "",
            motion: carry?.motion ?? "",
            durationSec: carry?.durationSec ?? estimateDuration(narration),
            status: "generated",
            ttsScript:
              carry?.ttsScript &&
              carry.ttsScript !== carry.narration &&
              (carry.narration ?? "").trim() === narration
                ? carry.ttsScript
                : undefined,
          };
        })
        .filter((s) => s.narration);
      if (scenes.length === 0) {
        return NextResponse.json({ ok: false, error: "결과 스크립트가 비었어요 — 다시 시도" }, { status: 502 });
      }
      const now = Date.now();
      project.scenes = scenes;
      project.steps.script.chat.push(
        { role: "user", text: userMessage, ts: now },
        { role: "assistant", text: reply, ts: now }
      );
      project.steps.script.updatedAt = now;
      project.updatedAt = now;
      await saveProject(project);
      return NextResponse.json({ ok: true, reply, scenes, chat: project.steps.script.chat });
    } catch (e) {
      return NextResponse.json(
        { ok: false, error: e instanceof Error ? e.message : "스크립트 대화 실패" },
        { status: 500 }
      );
    }
  }

  let label = project.styleProfileId;
  try {
    label = getStyleProfile(project.styleProfileId).label;
  } catch {
    /* 프로필 못 찾으면 id 그대로 */
  }

  try {
    const { reply, styleBible } = await runKeyframeChat({
      projectId,
      styleProfileLabel: label,
      currentStyleBible: project.styleBible,
      userMessage,
    });

    const now = Date.now();
    project.styleBible = styleBible;
    project.steps.keyframe.chat.push(
      { role: "user", text: userMessage, ts: now },
      { role: "assistant", text: reply, ts: now }
    );
    project.steps.keyframe.updatedAt = now;
    project.updatedAt = now;
    await saveProject(project);

    return NextResponse.json({
      ok: true,
      reply,
      styleBible,
      chat: project.steps.keyframe.chat,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "미세조정 실패" },
      { status: 500 }
    );
  }
}
