import { NextRequest, NextResponse } from "next/server";
import { getProject, saveProject } from "@/lib/projectStore";
import { runKeyframeChat } from "@/lib/stepChat";
import { getStyleProfile } from "@/lib/styleProfiles";
import type { StepKind } from "@/lib/types";

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
  if (body.step !== "keyframe") {
    return NextResponse.json(
      { ok: false, error: "현재는 키프레임 단계만 미세조정 지원" },
      { status: 400 }
    );
  }

  const project = await getProject(projectId);
  if (!project) {
    return NextResponse.json({ ok: false, error: "프로젝트 없음" }, { status: 404 });
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
