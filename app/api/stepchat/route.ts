import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { runKeyframeChat, runSourceChat } from "@/lib/stepChat";
import { getStyleProfile } from "@/lib/styleProfiles";
import type { StepKind } from "@/lib/types";
import type { SourceMaterial } from "@/lib/source";

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
  if (body.step !== "keyframe" && body.step !== "source") {
    return NextResponse.json(
      { ok: false, error: "현재는 소스·키프레임 단계만 대화 지원" },
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
